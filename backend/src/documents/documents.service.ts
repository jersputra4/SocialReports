import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AuditAction } from '../common/audit/audit-actions';
import { OutboxEventType, OutboxService } from '../notifications/outbox.service';
import { StorageService } from '../storage/storage.service';
import { sha256Hex } from '../common/utils/crypto.util';
import { uuidv7 } from '../common/utils/uuid-v7';
import { buildReportPdf, ReportPdfData } from './report-pdf.builder';

/**
 * pdfmake adalah paket CommonJS tanpa ekspor default bertipe untuk sisi Node,
 * jadi dimuat lewat `require`. Tipe definisi dokumennya tetap dipakai lewat
 * `pdfmake/interfaces` di report-pdf.builder.ts.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PdfPrinter = require('pdfmake');

/**
 * Font standar PDF (Helvetica, Courier) tersedia di dalam berkas PDF itu
 * sendiri, sehingga tidak ada berkas font yang perlu diunduh saat build maupun
 * saat runtime. Generator PDF berjalan tanpa akses jaringan sama sekali
 * (BRD 4.2, AC-34).
 */
const PDF_FONTS = {
  Helvetica: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  },
  Courier: {
    normal: 'Courier',
    bold: 'Courier-Bold',
    italics: 'Courier-Oblique',
    bolditalics: 'Courier-BoldOblique',
  },
};

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);
  private readonly printer = new PdfPrinter(PDF_FONTS);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Membuat PDF report sebagai VERSI BARU.
   * Versi lama tidak pernah ditimpa, sehingga dokumen yang sudah pernah
   * dibagikan tetap dapat diverifikasi ulang lewat hash-nya (AC-34).
   */
  async generateReportPdf(input: {
    reportId: string;
    includeProofs: boolean;
    actorId?: string | null;
    actorRole?: string | null;
  }): Promise<{ documentId: string; version: number; fileHash: string }> {
    const data = await this.collect(input.reportId, input.includeProofs);

    const definition = buildReportPdf(data);
    const buffer = await this.render(definition);
    const fileHash = sha256Hex(buffer);

    const documentId = uuidv7();
    const path = StorageService.documentPath(input.reportId, documentId);
    await this.storage.put(path, buffer, 'application/pdf');

    const document = await this.prisma.$transaction(async (tx) => {
      const last = await tx.reportDocument.findFirst({
        where: { reportId: input.reportId, documentType: 'REPORT_PDF' },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const version = (last?.version ?? 0) + 1;

      const created = await tx.reportDocument.create({
        data: {
          id: documentId,
          reportId: input.reportId,
          documentType: 'REPORT_PDF',
          version,
          fileName: `${data.reportCode}-v${version}.pdf`,
          fileHash,
          fileSize: buffer.byteLength,
          storagePath: path,
          includesProofs: input.includeProofs,
        },
      });

      await this.audit.record(
        {
          action: AuditAction.PDF_GENERATION,
          entityType: 'report_document',
          entityId: created.id,
          actorId: input.actorId ?? null,
          actorRole: input.actorRole ?? 'system',
          after: {
            reportCode: data.reportCode,
            version,
            fileHash,
            includesProofs: input.includeProofs,
          },
        },
        tx,
      );

      await this.outbox.enqueue(
        {
          eventType: OutboxEventType.PDF_GENERATED,
          reportId: input.reportId,
          reportCode: data.reportCode,
          status: data.status,
        },
        tx,
      );

      return created;
    });

    this.logger.log(
      `PDF ${data.reportCode} versi ${document.version} dibuat (${buffer.byteLength} byte)`,
    );

    return { documentId: document.id, version: document.version, fileHash };
  }

  private render(definition: ReturnType<typeof buildReportPdf>): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const stream = this.printer.createPdfKitDocument(definition);
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
      stream.end();
    });
  }

  private async collect(reportId: string, includeProofs: boolean): Promise<ReportPdfData> {
    const report = await this.prisma.report.findUniqueOrThrow({
      where: { id: reportId },
      include: {
        actionType: true,
        targetSnapshot: true,
        policies: { orderBy: { createdAt: 'asc' } },
        legalBasis: { orderBy: { createdAt: 'asc' } },
        evidences: { where: { scanStatus: 'CLEAN' }, orderBy: { createdAt: 'asc' } },
        statusHistory: { orderBy: { occurredAt: 'asc' } },
        invoices: { orderBy: { issuedAt: 'desc' }, take: 1 },
        proofs: {
          where: { voidedAt: null, visibleToUser: true, scanStatus: 'CLEAN' },
          orderBy: { reportedAt: 'asc' },
        },
      },
    });

    const proofs: ReportPdfData['proofs'] = [];
    if (includeProofs) {
      for (const proof of report.proofs) {
        let dataUri: string | undefined;
        try {
          const bytes = await this.storage.get(proof.storagePath);
          dataUri = `data:${proof.fileType};base64,${bytes.toString('base64')}`;
        } catch (error) {
          this.logger.warn(
            `Gambar bukti ${proof.id} tidak dapat dilampirkan: ${(error as Error).message}`,
          );
        }
        proofs.push({
          proofType: proof.proofType,
          reportedAt: proof.reportedAt,
          caption: proof.caption,
          unitsReported: proof.unitsReported,
          fileName: proof.fileName,
          fileHash: proof.fileHash,
          dataUri,
        });
      }
    }

    return {
      reportCode: report.reportCode,
      status: report.status,
      createdAt: report.createdAt,
      generatedAt: new Date(),
      actionTypeName: report.actionType.name,
      packageQuantity: report.packageQuantity,

      targetUrl: report.targetSnapshot?.originalUrl ?? null,
      canonicalUrl: report.targetSnapshot?.canonicalUrl ?? null,
      platformName: report.platformNameSnapshot,
      targetMetadata: (report.targetSnapshot?.metadataJson as Record<string, string>) ?? {},
      targetFetchStatus: report.targetSnapshot?.fetchStatus ?? 'MANUAL',

      unitPrice: report.unitPriceSnapshot,
      subtotal: report.subtotalSnapshot,
      taxRateBp: report.taxRateBpSnapshot,
      taxAmount: report.taxAmountSnapshot,
      totalAmount: report.totalAmountSnapshot,
      invoiceNumber: report.invoices[0]?.invoiceNumber ?? null,

      description: report.description,

      policies: report.policies.map((policy) => ({
        name: policy.nameSnapshot,
        version: policy.versionSnapshot,
        text: policy.textSnapshot,
        otherReason: policy.otherReason,
      })),

      legalBasis: report.legalBasis.map((legal) => ({
        lawName: legal.lawNameSnapshot,
        lawVersion: legal.lawVersionSnapshot,
        articleNumber: legal.articleNumberSnapshot,
        paragraphNumber: legal.paragraphNumberSnapshot,
        text: legal.textSnapshot,
        explanation: legal.explanationSnapshot,
        otherReason: legal.otherReason,
      })),

      evidences: report.evidences.map((evidence) => ({
        fileName: evidence.fileName,
        fileHash: evidence.fileHash,
        fileSize: evidence.fileSize,
        caption: evidence.caption,
        createdAt: evidence.createdAt,
      })),

      statusHistory: report.statusHistory.map((entry) => ({
        from: entry.fromStatus,
        to: entry.toStatus,
        occurredAt: entry.occurredAt,
        reason: entry.reason,
      })),

      proofs,
    };
  }

  // ----------------------------------------------------------------- akses --

  async listForReport(reportCode: string, requesterId: string, isStaff: boolean) {
    const report = await this.prisma.report.findUnique({
      where: { reportCode },
      select: { id: true, userId: true },
    });
    if (!report || (!isStaff && report.userId !== requesterId)) {
      throw new NotFoundException('Report tidak ditemukan.');
    }

    return this.prisma.reportDocument.findMany({
      where: { reportId: report.id },
      orderBy: [{ documentType: 'asc' }, { version: 'desc' }],
      select: {
        id: true,
        documentType: true,
        version: true,
        fileName: true,
        fileHash: true,
        fileSize: true,
        includesProofs: true,
        generatedAt: true,
      },
    });
  }

  async downloadUrl(documentId: string, requesterId: string, isStaff: boolean) {
    const document = await this.prisma.reportDocument.findUnique({
      where: { id: documentId },
      include: { report: { select: { userId: true, reportCode: true } } },
    });

    if (!document || (!isStaff && document.report.userId !== requesterId)) {
      await this.audit.record({
        action: AuditAction.ACCESS_DENIED,
        entityType: 'report_document',
        entityId: documentId,
      });
      throw new NotFoundException('Dokumen tidak ditemukan.');
    }

    const signed = await this.storage.signedDownloadUrl(document.storagePath, document.fileName);

    await this.audit.record({
      action: AuditAction.DOWNLOAD_PDF,
      entityType: 'report_document',
      entityId: document.id,
      after: { reportCode: document.report.reportCode, version: document.version },
    });

    return { ...signed, fileName: document.fileName, fileHash: document.fileHash };
  }
}
