import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AuditAction } from '../common/audit/audit-actions';
import { OutboxEventType, OutboxService } from '../notifications/outbox.service';
import { ReportTransitionService } from '../reports/report-transition.service';

/**
 * Pencatatan pelaporan ke platform (BRD 7.2 baris 18, AC-24).
 *
 * Sistem ini tidak melapor ke platform secara otomatis. Admin melakukannya
 * lewat jalur resmi masing-masing platform, lalu mencatat kanal, waktu, dan
 * nomor acuan di sini. Tanpa catatan ini report tidak dapat berpindah ke
 * SUBMITTED — itulah yang membuat klaim "sudah dilaporkan" punya bukti.
 */
@Injectable()
export class ComplaintsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly transitions: ReportTransitionService,
  ) {}

  async submitToPlatform(input: {
    reportCode: string;
    channel: string;
    externalReference?: string;
    notes?: string;
    adminId: string;
    adminRole: string;
  }): Promise<{ reportCode: string; status: string }> {
    const report = await this.prisma.report.findUnique({
      where: { reportCode: input.reportCode },
    });
    if (!report) throw new NotFoundException('Report tidak ditemukan.');

    return this.prisma.$transaction(async (tx) => {
      await tx.complaintSubmission.create({
        data: {
          reportId: report.id,
          channel: input.channel,
          submittedBy: input.adminId,
          submittedAt: new Date(),
          externalReference: input.externalReference?.slice(0, 256),
          notes: input.notes,
          // Admin mencatat pelaporan yang sudah ia lakukan sendiri, jadi
          // pengirimannya selesai saat baris ini dibuat. Default kolom
          // (PENDING) berlaku untuk kiriman otomatis yang belum dikerjakan job.
          deliveryStatus: 'SENT',
          attemptCount: 1,
          lastAttemptAt: new Date(),
        },
      });

      await this.audit.record(
        {
          action: AuditAction.EXTERNAL_SUBMISSION,
          entityType: 'report',
          entityId: report.reportCode,
          actorId: input.adminId,
          actorRole: input.adminRole,
          after: {
            channel: input.channel,
            externalReference: input.externalReference ?? null,
          },
        },
        tx,
      );

      await this.outbox.enqueue(
        {
          eventType: OutboxEventType.COMPLAINT_SUBMITTED,
          reportId: report.id,
          reportCode: report.reportCode,
          status: report.status,
        },
        tx,
      );

      const updated = await this.transitions.transitionWithin(tx, {
        reportId: report.id,
        to: 'SUBMITTED',
        actor: 'ADMIN',
        actorId: input.adminId,
        actorRole: input.adminRole,
        extraGuards: ['COMPLAINT_SUBMISSION'],
      });

      return { reportCode: updated.reportCode, status: updated.status };
    });
  }

  async listForReport(reportCode: string) {
    const report = await this.prisma.report.findUnique({
      where: { reportCode },
      select: { id: true },
    });
    if (!report) throw new NotFoundException('Report tidak ditemukan.');

    return this.prisma.complaintSubmission.findMany({
      where: { reportId: report.id },
      orderBy: { submittedAt: 'desc' },
      include: { user: { select: { fullName: true } } },
    });
  }
}
