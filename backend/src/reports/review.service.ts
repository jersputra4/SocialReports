import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ReviewDecisionType } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AuditAction, AuditActionValue } from '../common/audit/audit-actions';
import { ReportStatusValue } from './state-machine';
import { ReportTransitionService } from './report-transition.service';

const STATUS_BY_DECISION: Record<ReviewDecisionType, ReportStatusValue> = {
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  NEEDS_REVISION: 'NEEDS_REVISION',
};

const AUDIT_BY_DECISION: Record<ReviewDecisionType, AuditActionValue> = {
  APPROVED: AuditAction.REVIEW_APPROVE,
  REJECTED: AuditAction.REVIEW_REJECT,
  NEEDS_REVISION: AuditAction.REVIEW_REQUEST_REVISION,
};

/**
 * Keputusan review (BRD 7.2 baris 13-15, AC-21).
 *
 * Tiga keputusan, semuanya menuntut alasan tertulis minimal 10 karakter —
 * dijaga di sini, pada DTO, dan oleh check constraint di database. Keputusan
 * dan transisi status ditulis dalam satu transaksi, sehingga tidak mungkin ada
 * report yang berubah status tanpa alasan yang tercatat.
 */
@Injectable()
export class ReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly transitions: ReportTransitionService,
  ) {}

  async decide(input: {
    reportCode: string;
    decision: ReviewDecisionType;
    reason: string;
    checklist?: Record<string, boolean>;
    reviewerId: string;
    reviewerRole: string;
  }): Promise<{ reportCode: string; status: string }> {
    if (input.reason.trim().length < 10) {
      throw new BadRequestException('Alasan wajib diisi minimal 10 karakter.');
    }

    const report = await this.prisma.report.findUnique({
      where: { reportCode: input.reportCode },
    });
    if (!report) throw new NotFoundException('Report tidak ditemukan.');

    return this.prisma.$transaction(async (tx) => {
      await tx.reviewDecision.create({
        data: {
          reportId: report.id,
          decision: input.decision,
          reason: input.reason,
          checklistJson: (input.checklist ?? undefined) as Prisma.InputJsonValue | undefined,
          decidedBy: input.reviewerId,
        },
      });

      await this.audit.record(
        {
          action: AUDIT_BY_DECISION[input.decision],
          entityType: 'report',
          entityId: report.reportCode,
          actorId: input.reviewerId,
          actorRole: input.reviewerRole,
          after: { decision: input.decision, reason: input.reason },
        },
        tx,
      );

      const updated = await this.transitions.transitionWithin(tx, {
        reportId: report.id,
        to: STATUS_BY_DECISION[input.decision],
        actor: 'REVIEWER',
        actorId: input.reviewerId,
        actorRole: input.reviewerRole,
        reason: input.reason,
        extraGuards: ['REVIEW_DECISION'],
      });

      return { reportCode: updated.reportCode, status: updated.status };
    });
  }

  async history(reportCode: string) {
    const report = await this.prisma.report.findUnique({
      where: { reportCode },
      select: { id: true },
    });
    if (!report) throw new NotFoundException('Report tidak ditemukan.');

    return this.prisma.reviewDecision.findMany({
      where: { reportId: report.id },
      orderBy: { decidedAt: 'desc' },
      include: { user: { select: { fullName: true } } },
    });
  }

  /** Antrean review: report tertua lebih dulu (mendukung KPI-01). */
  async queue(limit = 50) {
    const rows = await this.prisma.report.findMany({
      where: { status: 'WAITING_REVIEW' },
      orderBy: { updatedAt: 'asc' },
      take: limit,
      include: {
        user: { select: { fullName: true, email: true } },
        targetSnapshot: { select: { originalUrl: true, fetchStatus: true } },
        _count: { select: { evidences: true } },
      },
    });

    return rows.map((row) => ({
      reportCode: row.reportCode,
      platformName: row.platformNameSnapshot,
      policyName: row.policyNameSnapshot,
      lawName: row.lawNameSnapshot,
      packageQuantity: row.packageQuantity,
      evidenceCount: row._count.evidences,
      targetUrl: row.targetSnapshot?.originalUrl ?? null,
      waitingSince: row.updatedAt,
      owner: row.user.fullName,
    }));
  }
}
