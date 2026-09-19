import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, Report, ReportStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AuditAction } from '../common/audit/audit-actions';
import { OutboxEventType, OutboxEventTypeValue, OutboxService } from '../notifications/outbox.service';
import {
  ReportStatusValue,
  TransitionActor,
  TransitionGuard,
  assertTransition,
} from './state-machine';

export interface TransitionInput {
  reportId: string;
  to: ReportStatusValue;
  actor: TransitionActor;
  actorId?: string | null;
  actorRole?: string | null;
  reason?: string | null;
  /**
   * Guard yang sudah dipenuhi pemanggil dalam transaksi yang sama —
   * misalnya `REVIEW_DECISION` setelah keputusan review dicatat.
   */
  extraGuards?: TransitionGuard[];
}

/** Event notifikasi untuk tiap status tujuan (BRD 4.4). */
const EVENT_BY_STATUS: Partial<Record<ReportStatusValue, OutboxEventTypeValue>> = {
  WAITING_PAYMENT: OutboxEventType.REPORT_CREATED,
  PAYMENT_REVIEW: OutboxEventType.PAYMENT_SUBMITTED,
  PAID: OutboxEventType.PAYMENT_VERIFIED,
  EXPIRED: OutboxEventType.PAYMENT_EXPIRED,
  APPROVED: OutboxEventType.REPORT_APPROVED,
  REJECTED: OutboxEventType.REPORT_REJECTED,
  NEEDS_REVISION: OutboxEventType.REPORT_NEEDS_REVISION,
  SUBMITTED: OutboxEventType.REPORT_SUBMITTED,
  COMPLETED: OutboxEventType.REPORT_COMPLETED,
};

/**
 * Satu-satunya jalan untuk mengubah status report.
 *
 * Seluruh perubahan status melewati metode `transition`, yang di dalam SATU
 * transaksi database melakukan: pemeriksaan prasyarat, penerapan aturan tabel
 * 7.2, penulisan riwayat status, penulisan audit log, dan penulisan event
 * outbox. Tidak ada jalur lain yang menyentuh kolom `status`, sehingga tidak
 * mungkin ada perubahan status yang tidak tercatat.
 */
@Injectable()
export class ReportTransitionService {
  private readonly logger = new Logger(ReportTransitionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async transition(input: TransitionInput): Promise<Report> {
    return this.prisma.$transaction(async (tx) => this.transitionWithin(tx, input));
  }

  /** Varian untuk dipakai di dalam transaksi yang sudah berjalan. */
  async transitionWithin(tx: Prisma.TransactionClient, input: TransitionInput): Promise<Report> {
    // Kunci baris report agar dua permintaan bersamaan tidak menghasilkan dua
    // transisi dari status yang sama (mis. webhook duplikat — AC-15).
    const locked = await tx.$queryRaw<Array<{ report_id: string; status: ReportStatus }>>(
      Prisma.sql`SELECT report_id, status FROM reports WHERE report_id = ${input.reportId}::uuid FOR UPDATE`,
    );
    if (locked.length === 0) {
      throw new NotFoundException('Report tidak ditemukan.');
    }

    const report = await tx.report.findUniqueOrThrow({ where: { id: input.reportId } });
    const from = report.status as ReportStatusValue;

    const guards = await this.collectGuards(tx, report);
    for (const guard of input.extraGuards ?? []) guards.add(guard);

    const rule = assertTransition({
      from,
      to: input.to,
      actor: input.actor,
      reason: input.reason,
      satisfiedGuards: [...guards],
    });

    const now = new Date();
    const data: Prisma.ReportUpdateInput = { status: input.to as ReportStatus };

    if (input.to === 'SUBMITTED') {
      data.submittedAt = now;
      if (from === 'FAILED') data.retryCount = { increment: 1 };
    }
    if (input.to === 'COMPLETED') data.completedAt = now;
    if (input.to === 'EXPIRED') data.expiredAt = now;
    if (input.to === 'ARCHIVED') data.archivedAt = now;

    const updated = await tx.report.update({ where: { id: report.id }, data });

    await tx.reportStatusHistory.create({
      data: {
        reportId: report.id,
        fromStatus: from as ReportStatus,
        toStatus: input.to as ReportStatus,
        actorId: input.actorId ?? null,
        actorRole: input.actorRole ?? input.actor,
        reason: input.reason ?? null,
      },
    });

    await this.audit.record(
      {
        action: AuditAction.STATUS_CHANGE,
        entityType: 'report',
        entityId: report.reportCode,
        actorId: input.actorId ?? null,
        actorRole: input.actorRole ?? input.actor,
        before: { status: from },
        after: { status: input.to, transitionRule: rule.id, reason: input.reason ?? null },
      },
      tx,
    );

    const eventType = EVENT_BY_STATUS[input.to];
    if (eventType) {
      await this.outbox.enqueue(
        {
          eventType,
          reportId: report.id,
          reportCode: report.reportCode,
          status: input.to,
        },
        tx,
      );
    }

    this.logger.log(`Report ${report.reportCode}: ${from} -> ${input.to} (aturan ${rule.id})`);
    return updated;
  }

  /**
   * Menghitung prasyarat yang sudah terpenuhi dari keadaan data saat ini.
   * Dikerjakan di dalam transaksi yang sama dengan transisinya, sehingga
   * tidak ada celah antara pemeriksaan dan penerapan.
   */
  private async collectGuards(
    tx: Prisma.TransactionClient,
    report: Report,
  ): Promise<Set<TransitionGuard>> {
    const guards = new Set<TransitionGuard>();

    if (report.snapshotSealedAt) guards.add('SNAPSHOT_SEALED');

    const [user, policyCount, legalCount, payment, paidPayment, complaint, proofs, consent] =
      await Promise.all([
        tx.user.findUnique({
          where: { id: report.userId },
          select: { emailVerifiedAt: true },
        }),
        tx.reportPolicy.count({ where: { reportId: report.id } }),
        tx.reportLegalBasis.count({ where: { reportId: report.id } }),
        tx.payment.findFirst({
          where: { reportId: report.id },
          orderBy: { createdAt: 'desc' },
        }),
        tx.payment.findFirst({
          where: { reportId: report.id, status: 'SETTLED' },
          orderBy: { createdAt: 'desc' },
        }),
        tx.complaintSubmission.count({ where: { reportId: report.id } }),
        tx.reportCompletionProof.findMany({
          where: {
            reportId: report.id,
            voidedAt: null,
            visibleToUser: true,
            scanStatus: 'CLEAN',
          },
          select: { unitsReported: true },
        }),
        tx.userConsent.count({
          where: { userId: report.userId, reportId: report.id, documentType: 'NO_REFUND' },
        }),
      ]);

    if (user?.emailVerifiedAt) guards.add('EMAIL_VERIFIED');
    if (consent > 0) guards.add('NO_REFUND_CONSENT');
    if (report.targetSnapshotId && policyCount > 0 && legalCount > 0) guards.add('DATA_COMPLETE');
    if (complaint > 0) guards.add('COMPLAINT_SUBMISSION');

    if (payment) {
      if (payment.status === 'PENDING') guards.add('PAYMENT_ORDER_CREATED');
      if (payment.expiresAt.getTime() <= Date.now()) guards.add('EXPIRY_ELAPSED');
      if (payment.paidAmount === 0n) guards.add('PAYMENT_NOT_STARTED');
    } else {
      guards.add('PAYMENT_NOT_STARTED');
    }

    if (paidPayment && paidPayment.paidAmount >= paidPayment.totalAmount) {
      guards.add('PAYMENT_SETTLED');
    }

    if (proofs.length > 0) {
      guards.add('ACTIVE_PROOF');

      const reportedUnits = proofs.reduce((sum, proof) => sum + (proof.unitsReported ?? 0), 0);
      const anyUnitsRecorded = proofs.some((proof) => proof.unitsReported !== null);

      // BRD 7.2 baris 20: unit dicek hanya bila units_reported diisi.
      if (!anyUnitsRecorded || reportedUnits >= report.packageQuantity) {
        guards.add('UNITS_FULFILLED');
      }
      if (anyUnitsRecorded && reportedUnits < report.packageQuantity) {
        guards.add('UNITS_PARTIAL');
      }
    }

    if (report.expiredAt) {
      const days = (Date.now() - report.expiredAt.getTime()) / 86_400_000;
      if (days <= 7) guards.add('RETRY_WINDOW');
      else guards.add('RETRY_WINDOW_ELAPSED');
    }

    // Keputusan pengarsipan mengikuti kebijakan retensi yang dijalankan admin
    // atau job terjadwal; tidak ada syarat data tambahan.
    guards.add('RETENTION_POLICY');

    return guards;
  }
}
