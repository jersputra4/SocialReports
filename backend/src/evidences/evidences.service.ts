import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AuditAction } from '../common/audit/audit-actions';
import { UploadPipelineService } from '../common/uploads/upload-pipeline.service';
import { StorageService } from '../storage/storage.service';
import { uuidv7 } from '../common/utils/uuid-v7';
import { EDITABLE_STATUSES, ReportStatusValue } from '../reports/state-machine';

@Injectable()
export class EvidencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly pipeline: UploadPipelineService,
    private readonly storage: StorageService,
  ) {}

  async upload(input: {
    userId: string;
    reportCode: string;
    file: { originalname: string; buffer: Buffer; size: number };
    caption?: string;
  }) {
    const report = await this.prisma.report.findFirst({
      where: { reportCode: input.reportCode, userId: input.userId },
    });
    if (!report) throw new NotFoundException('Report tidak ditemukan.');

    if (!EDITABLE_STATUSES.includes(report.status as ReportStatusValue)) {
      throw new ConflictException(
        `Evidence hanya dapat ditambahkan saat report berstatus ${EDITABLE_STATUSES.join(' atau ')}.`,
      );
    }

    const processed = await this.pipeline.process(input.file);

    // Id dibuat lebih dulu karena dipakai sebagai nama objek di storage.
    const evidenceId = uuidv7();
    const path = StorageService.evidencePath(report.id, evidenceId, processed.extension);

    if (!processed.scan.clean) {
      // Berkas terindikasi berbahaya tidak pernah disimpan.
      await this.audit.record({
        action: AuditAction.UPDATE_REPORT,
        entityType: 'report',
        entityId: report.reportCode,
        actorId: input.userId,
        after: { event: 'EVIDENCE_REJECTED', reason: processed.scan.reason },
      });
      throw new BadRequestException(
        `Berkas ditolak: ${processed.scan.reason ?? 'tidak lolos pemindaian'}.`,
      );
    }

    await this.storage.put(path, processed.buffer, processed.mimeType);

    const evidence = await this.prisma.evidence.create({
      data: {
        id: evidenceId,
        reportId: report.id,
        fileName: processed.fileName,
        fileType: processed.mimeType,
        fileSize: processed.size,
        fileHash: processed.sha256,
        storagePath: path,
        caption: input.caption?.slice(0, 500),
        scanStatus: 'CLEAN',
        scannedAt: new Date(),
      },
    });

    await this.audit.record({
      action: AuditAction.UPDATE_REPORT,
      entityType: 'evidence',
      entityId: evidence.id,
      actorId: input.userId,
      after: {
        reportCode: report.reportCode,
        fileName: processed.fileName,
        fileHash: processed.sha256,
        fileSize: processed.size,
      },
    });

    return {
      id: evidence.id,
      fileName: evidence.fileName,
      fileSize: evidence.fileSize,
      fileHash: evidence.fileHash,
      scanStatus: evidence.scanStatus,
      caption: evidence.caption,
      createdAt: evidence.createdAt,
    };
  }

  async list(userId: string, reportCode: string) {
    const report = await this.prisma.report.findFirst({
      where: { reportCode, userId },
      select: { id: true },
    });
    if (!report) throw new NotFoundException('Report tidak ditemukan.');

    const rows = await this.prisma.evidence.findMany({
      where: { reportId: report.id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        fileName: true,
        fileType: true,
        fileSize: true,
        fileHash: true,
        caption: true,
        scanStatus: true,
        createdAt: true,
      },
    });
    return rows;
  }

  /**
   * URL unduh sementara.
   *
   * Kepemilikan diperiksa di backend sebelum URL dibuat; evidence milik orang
   * lain menghasilkan 404 (AC-07). URL berumur <= 120 detik (AC-29).
   */
  async downloadUrl(params: {
    evidenceId: string;
    requesterId: string;
    isStaff: boolean;
  }): Promise<{ url: string; expiresInSeconds: number; fileName: string }> {
    const evidence = await this.prisma.evidence.findUnique({
      where: { id: params.evidenceId },
      include: { report: { select: { userId: true, reportCode: true } } },
    });

    const allowed = evidence && (params.isStaff || evidence.report.userId === params.requesterId);
    if (!evidence || !allowed) {
      await this.audit.record({
        action: AuditAction.ACCESS_DENIED,
        entityType: 'evidence',
        entityId: params.evidenceId,
      });
      throw new NotFoundException('Evidence tidak ditemukan.');
    }

    const signed = await this.storage.signedDownloadUrl(evidence.storagePath, evidence.fileName);

    await this.audit.record({
      action: AuditAction.VIEW_EVIDENCE,
      entityType: 'evidence',
      entityId: evidence.id,
      after: { reportCode: evidence.report.reportCode },
    });

    return { ...signed, fileName: evidence.fileName };
  }

  async remove(userId: string, evidenceId: string): Promise<void> {
    const evidence = await this.prisma.evidence.findUnique({
      where: { id: evidenceId },
      include: { report: true },
    });
    if (!evidence || evidence.report.userId !== userId) {
      throw new NotFoundException('Evidence tidak ditemukan.');
    }
    if (!EDITABLE_STATUSES.includes(evidence.report.status as ReportStatusValue)) {
      throw new ConflictException('Evidence tidak dapat dihapus setelah report dikunci.');
    }

    await this.prisma.evidence.delete({ where: { id: evidenceId } });
    await this.storage.remove(evidence.storagePath);

    await this.audit.record({
      action: AuditAction.UPDATE_REPORT,
      entityType: 'evidence',
      entityId: evidenceId,
      actorId: userId,
      before: { fileName: evidence.fileName, reportCode: evidence.report.reportCode },
      after: { deleted: true },
    });
  }

  /** Daftar evidence untuk halaman review admin. */
  async listForAdmin(reportCode: string) {
    const report = await this.prisma.report.findUnique({
      where: { reportCode },
      select: { id: true },
    });
    if (!report) throw new NotFoundException('Report tidak ditemukan.');

    return this.prisma.evidence.findMany({
      where: { reportId: report.id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        fileName: true,
        fileType: true,
        fileSize: true,
        fileHash: true,
        caption: true,
        scanStatus: true,
        createdAt: true,
      },
    });
  }
}
