import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProofType } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AuditAction } from '../common/audit/audit-actions';
import { OutboxEventType, OutboxService } from '../notifications/outbox.service';
import { UploadPipelineService } from '../common/uploads/upload-pipeline.service';
import { StorageService } from '../storage/storage.service';
import { uuidv7 } from '../common/utils/uuid-v7';

/**
 * Bukti Pengerjaan — BRD/SRS v1.1 bagian 8 (fitur baru pada v1.1).
 *
 * Aturan yang dijaga di sini:
 *   - hanya dapat ditambahkan saat report berstatus SUBMITTED atau
 *     PARTIALLY_COMPLETED;
 *   - waktu pelaporan tidak boleh di masa depan dan tidak boleh mendahului
 *     saat report disetujui;
 *   - bukti tidak pernah dihapus permanen — pembatalan memakai void dengan
 *     alasan wajib, dan bukti yang di-void hilang dari tampilan user tetapi
 *     tetap terlihat admin dan audit;
 *   - berkas melewati pipeline yang sama dengan evidence: magic bytes,
 *     sanitasi nama, pembuangan EXIF, hash SHA-256, pemindaian, penyimpanan
 *     privat. Tanpa OCR.
 */
@Injectable()
export class ProofsService {
  private static readonly UPLOADABLE_STATUSES = ['SUBMITTED', 'PARTIALLY_COMPLETED'];

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly pipeline: UploadPipelineService,
    private readonly storage: StorageService,
  ) {}

  async upload(input: {
    adminId: string;
    adminRole: string;
    reportCode: string;
    file: { originalname: string; buffer: Buffer; size: number };
    proofType: ProofType;
    reportedAt: Date;
    caption?: string;
    unitsReported?: number;
    visibleToUser: boolean;
  }) {
    const report = await this.prisma.report.findUnique({
      where: { reportCode: input.reportCode },
      include: {
        statusHistory: {
          where: { toStatus: 'APPROVED' },
          orderBy: { occurredAt: 'asc' },
          take: 1,
        },
      },
    });
    if (!report) throw new NotFoundException('Report tidak ditemukan.');

    if (!ProofsService.UPLOADABLE_STATUSES.includes(report.status)) {
      throw new ConflictException(
        'Bukti pengerjaan hanya dapat ditambahkan saat report berstatus SUBMITTED atau PARTIALLY_COMPLETED.',
      );
    }

    if (input.reportedAt.getTime() > Date.now() + 120_000) {
      throw new BadRequestException('Waktu pelaporan tidak boleh di masa depan.');
    }

    const approvedAt = report.statusHistory[0]?.occurredAt;
    if (approvedAt && input.reportedAt.getTime() < approvedAt.getTime()) {
      throw new BadRequestException(
        'Waktu pelaporan tidak boleh mendahului saat report disetujui.',
      );
    }

    if (input.unitsReported !== undefined && input.unitsReported <= 0) {
      throw new BadRequestException('Jumlah unit tercakup harus lebih besar dari nol.');
    }

    const processed = await this.pipeline.process(input.file);
    if (!processed.scan.clean) {
      throw new BadRequestException(
        `Berkas ditolak: ${processed.scan.reason ?? 'tidak lolos pemindaian'}.`,
      );
    }

    const proofId = uuidv7();
    const path = StorageService.proofPath(report.id, proofId, processed.extension);
    await this.storage.put(path, processed.buffer, processed.mimeType);

    const proof = await this.prisma.$transaction(async (tx) => {
      const created = await tx.reportCompletionProof.create({
        data: {
          id: proofId,
          reportId: report.id,
          uploadedBy: input.adminId,
          proofType: input.proofType,
          reportedAt: input.reportedAt,
          caption: input.caption?.slice(0, 500),
          unitsReported: input.unitsReported ?? null,
          fileName: processed.fileName,
          fileType: processed.mimeType,
          fileSize: processed.size,
          fileHash: processed.sha256,
          storagePath: path,
          scanStatus: 'CLEAN',
          visibleToUser: input.visibleToUser,
        },
      });

      await this.audit.record(
        {
          action: AuditAction.PROOF_UPLOAD,
          entityType: 'report_completion_proof',
          entityId: created.id,
          actorId: input.adminId,
          actorRole: input.adminRole,
          after: {
            reportCode: report.reportCode,
            proofType: input.proofType,
            reportedAt: input.reportedAt.toISOString(),
            unitsReported: input.unitsReported ?? null,
            fileHash: processed.sha256,
            visibleToUser: input.visibleToUser,
          },
        },
        tx,
      );

      // Notifikasi ke admin lewat n8n dan email ke user (BRD 8.4).
      if (input.visibleToUser) {
        await this.outbox.enqueue(
          {
            eventType: OutboxEventType.PROOF_UPLOADED,
            reportId: report.id,
            reportCode: report.reportCode,
            status: report.status,
          },
          tx,
        );
      }

      return created;
    });

    return this.toPublic(proof);
  }

  async update(input: {
    adminId: string;
    adminRole: string;
    proofId: string;
    caption?: string;
    reportedAt?: Date;
    visibleToUser?: boolean;
    unitsReported?: number;
  }) {
    const proof = await this.prisma.reportCompletionProof.findUnique({
      where: { id: input.proofId },
      include: { report: { select: { reportCode: true } } },
    });
    if (!proof) throw new NotFoundException('Bukti pengerjaan tidak ditemukan.');
    if (proof.voidedAt) {
      throw new ConflictException('Bukti yang sudah di-void tidak dapat diubah.');
    }

    if (input.reportedAt && input.reportedAt.getTime() > Date.now() + 120_000) {
      throw new BadRequestException('Waktu pelaporan tidak boleh di masa depan.');
    }

    const updated = await this.prisma.reportCompletionProof.update({
      where: { id: input.proofId },
      data: {
        caption: input.caption?.slice(0, 500) ?? proof.caption,
        reportedAt: input.reportedAt ?? proof.reportedAt,
        visibleToUser: input.visibleToUser ?? proof.visibleToUser,
        unitsReported: input.unitsReported ?? proof.unitsReported,
      },
    });

    await this.audit.record({
      action: AuditAction.PROOF_UPDATE,
      entityType: 'report_completion_proof',
      entityId: proof.id,
      actorId: input.adminId,
      actorRole: input.adminRole,
      before: {
        caption: proof.caption,
        reportedAt: proof.reportedAt.toISOString(),
        visibleToUser: proof.visibleToUser,
        unitsReported: proof.unitsReported,
      },
      after: {
        caption: updated.caption,
        reportedAt: updated.reportedAt.toISOString(),
        visibleToUser: updated.visibleToUser,
        unitsReported: updated.unitsReported,
      },
    });

    return this.toPublic(updated);
  }

  /**
   * Void — pembatalan bukti tanpa penghapusan (BRD 8.2).
   * Endpoint pemanggil menuntut step-up MFA (AC-27).
   */
  async void(input: {
    adminId: string;
    adminRole: string;
    proofId: string;
    reason: string;
  }) {
    if (input.reason.trim().length < 10) {
      throw new BadRequestException('Alasan void wajib diisi minimal 10 karakter.');
    }

    const proof = await this.prisma.reportCompletionProof.findUnique({
      where: { id: input.proofId },
      include: { report: { select: { reportCode: true, status: true, id: true } } },
    });
    if (!proof) throw new NotFoundException('Bukti pengerjaan tidak ditemukan.');
    if (proof.voidedAt) throw new ConflictException('Bukti ini sudah di-void.');

    // Report yang sudah COMPLETED harus tetap punya minimal satu bukti aktif.
    if (proof.report.status === 'COMPLETED') {
      const remaining = await this.prisma.reportCompletionProof.count({
        where: {
          reportId: proof.reportId,
          voidedAt: null,
          visibleToUser: true,
          scanStatus: 'CLEAN',
          id: { not: proof.id },
        },
      });
      if (remaining === 0) {
        throw new ConflictException(
          'Bukti terakhir pada report yang sudah selesai tidak dapat di-void. Unggah bukti pengganti terlebih dahulu.',
        );
      }
    }

    const updated = await this.prisma.reportCompletionProof.update({
      where: { id: proof.id },
      data: {
        voidedAt: new Date(),
        voidedBy: input.adminId,
        voidReason: input.reason,
      },
    });

    await this.audit.record({
      action: AuditAction.PROOF_VOID,
      entityType: 'report_completion_proof',
      entityId: proof.id,
      actorId: input.adminId,
      actorRole: input.adminRole,
      before: { voidedAt: null },
      after: { voidedAt: updated.voidedAt?.toISOString(), reason: input.reason },
    });

    return this.toPublic(updated);
  }

  // ------------------------------------------------------------- pembacaan --

  /** Tab "Bukti Pengerjaan" pada detail report milik user (BRD 8.3). */
  async listForUser(userId: string, reportCode: string) {
    const report = await this.prisma.report.findFirst({
      where: { reportCode, userId },
      select: { id: true, packageQuantity: true },
    });
    if (!report) {
      await this.audit.record({
        action: AuditAction.ACCESS_DENIED,
        entityType: 'report',
        entityId: reportCode,
      });
      throw new NotFoundException('Report tidak ditemukan.');
    }

    const proofs = await this.prisma.reportCompletionProof.findMany({
      where: {
        reportId: report.id,
        voidedAt: null,
        visibleToUser: true,
        scanStatus: 'CLEAN',
      },
      orderBy: { reportedAt: 'asc' },
    });

    const reportedUnits = proofs.reduce((sum, proof) => sum + (proof.unitsReported ?? 0), 0);
    const hasUnitData = proofs.some((proof) => proof.unitsReported !== null);

    return {
      items: proofs.map((proof) => this.toPublic(proof)),
      progress: hasUnitData
        ? {
            reportedUnits,
            packageQuantity: report.packageQuantity,
            percentage: Math.min(
              100,
              Math.round((reportedUnits / report.packageQuantity) * 100),
            ),
          }
        : null,
    };
  }

  /** Tampilan admin: memuat juga bukti yang di-void beserta alasannya. */
  async listForAdmin(reportCode: string) {
    const report = await this.prisma.report.findUnique({
      where: { reportCode },
      select: { id: true, packageQuantity: true },
    });
    if (!report) throw new NotFoundException('Report tidak ditemukan.');

    const proofs = await this.prisma.reportCompletionProof.findMany({
      where: { reportId: report.id },
      orderBy: { createdAt: 'desc' },
      include: {
        uploader: { select: { fullName: true, email: true } },
        voider: { select: { fullName: true, email: true } },
      },
    });

    return proofs.map((proof) => ({
      ...this.toPublic(proof),
      uploadedBy: proof.uploader.fullName,
      voidedBy: proof.voider?.fullName ?? null,
      voidReason: proof.voidReason,
      voidedAt: proof.voidedAt,
    }));
  }

  async downloadUrl(params: {
    proofId: string;
    requesterId: string;
    isStaff: boolean;
  }): Promise<{ url: string; expiresInSeconds: number; fileName: string }> {
    const proof = await this.prisma.reportCompletionProof.findUnique({
      where: { id: params.proofId },
      include: { report: { select: { userId: true, reportCode: true } } },
    });

    // User hanya boleh membuka bukti miliknya yang aktif dan terlihat.
    const visibleToOwner =
      proof &&
      proof.report.userId === params.requesterId &&
      proof.voidedAt === null &&
      proof.visibleToUser;

    if (!proof || !(params.isStaff || visibleToOwner)) {
      await this.audit.record({
        action: AuditAction.ACCESS_DENIED,
        entityType: 'report_completion_proof',
        entityId: params.proofId,
      });
      throw new NotFoundException('Bukti pengerjaan tidak ditemukan.');
    }

    const signed = await this.storage.signedDownloadUrl(proof.storagePath, proof.fileName);

    await this.audit.record({
      action: AuditAction.VIEW_PROOF,
      entityType: 'report_completion_proof',
      entityId: proof.id,
      after: { reportCode: proof.report.reportCode },
    });

    return { ...signed, fileName: proof.fileName };
  }

  private toPublic(proof: {
    id: string;
    proofType: ProofType;
    reportedAt: Date;
    caption: string | null;
    unitsReported: number | null;
    fileName: string;
    fileType: string;
    fileSize: number;
    fileHash: string;
    visibleToUser: boolean;
    voidedAt: Date | null;
    createdAt: Date;
  }) {
    return {
      id: proof.id,
      proofType: proof.proofType,
      reportedAt: proof.reportedAt,
      caption: proof.caption,
      unitsReported: proof.unitsReported,
      fileName: proof.fileName,
      fileType: proof.fileType,
      fileSize: proof.fileSize,
      fileHash: proof.fileHash,
      visibleToUser: proof.visibleToUser,
      isVoided: proof.voidedAt !== null,
      createdAt: proof.createdAt,
    };
  }
}
