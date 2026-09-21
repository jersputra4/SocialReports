import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AuthenticatedUser } from '../common/security/auth.types';
import { CurrentUser, RequirePermissions } from '../common/security/decorators';
import { FailReportDto, ListReportsQueryDto, ReviewDecisionDto } from './dto/report.dto';
import { ReportStatsService } from './report-stats.service';
import { ReportsService } from './reports.service';
import { ReportTransitionService } from './report-transition.service';
import { ReviewService } from './review.service';
import { allowedTargetsForActor, ReportStatusValue } from './state-machine';

/**
 * Endpoint admin untuk siklus hidup report.
 *
 * Setiap tindakan memakai izin yang berbeda sehingga pemisahan tugas dapat
 * diterapkan: reviewer memutuskan kelayakan (`report.review`), admin
 * operasional mengerjakan pelaporan dan bukti (`report.fulfill`).
 */
@Controller('admin/reports')
export class AdminReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly review: ReviewService,
    private readonly transitions: ReportTransitionService,
    private readonly stats: ReportStatsService,
  ) {}

  /**
   * Angka ringkas dasbor.
   *
   * Diletakkan sebelum rute `:reportCode` dengan sengaja. Nest mencocokkan
   * rute berurutan, jadi `:reportCode` yang ditaruh lebih dulu akan menelan
   * `/stats` dan menganggapnya kode report.
   */
  @Get('stats')
  @RequirePermissions('report.review')
  summary() {
    return this.stats.summary();
  }

  @Get()
  @RequirePermissions('report.review')
  list(@Query() query: ListReportsQueryDto) {
    return this.reports.listForAdmin(query);
  }

  @Get('review-queue')
  @RequirePermissions('report.review')
  queue() {
    return this.review.queue();
  }

  @Get(':reportCode')
  @RequirePermissions('report.review')
  async detail(@Param('reportCode') reportCode: string) {
    const report = await this.reports.findForAdmin(reportCode);
    return {
      ...report,
      availableActions: {
        admin: allowedTargetsForActor(report.status as ReportStatusValue, 'ADMIN'),
        reviewer: allowedTargetsForActor(report.status as ReportStatusValue, 'REVIEWER'),
        finance: allowedTargetsForActor(report.status as ReportStatusValue, 'FINANCE'),
      },
    };
  }

  /** Tiga keputusan review dalam satu endpoint (BRD 7.2 baris 13-15). */
  @Post(':reportCode/review')
  @RequirePermissions('report.review')
  decide(
    @Param('reportCode') reportCode: string,
    @Body() dto: ReviewDecisionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.review.decide({
      reportCode,
      decision: dto.decision,
      reason: dto.reason,
      checklist: dto.checklist,
      reviewerId: user.id,
      reviewerRole: user.roleCode,
    });
  }

  @Get(':reportCode/review-history')
  @RequirePermissions('report.review')
  history(@Param('reportCode') reportCode: string) {
    return this.review.history(reportCode);
  }

  /** Menandai sebagian unit selesai (BRD 7.2 baris 19). */
  @Post(':reportCode/mark-partially-completed')
  @RequirePermissions('report.fulfill')
  async markPartial(
    @Param('reportCode') reportCode: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const report = await this.reports.resolveAnyReport(reportCode);
    const updated = await this.transitions.transition({
      reportId: report.id,
      to: 'PARTIALLY_COMPLETED',
      actor: 'ADMIN',
      actorId: user.id,
      actorRole: user.roleCode,
    });
    return { reportCode: updated.reportCode, status: updated.status };
  }

  /** Menandai selesai — ditolak tanpa bukti pengerjaan aktif (AC-26). */
  @Post(':reportCode/mark-completed')
  @RequirePermissions('report.fulfill')
  async markCompleted(
    @Param('reportCode') reportCode: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const report = await this.reports.resolveAnyReport(reportCode);
    const updated = await this.transitions.transition({
      reportId: report.id,
      to: 'COMPLETED',
      actor: 'ADMIN',
      actorId: user.id,
      actorRole: user.roleCode,
    });
    return { reportCode: updated.reportCode, status: updated.status };
  }

  @Post(':reportCode/mark-failed')
  @RequirePermissions('report.fulfill')
  async markFailed(
    @Param('reportCode') reportCode: string,
    @Body() dto: FailReportDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const report = await this.reports.resolveAnyReport(reportCode);
    const updated = await this.transitions.transition({
      reportId: report.id,
      to: 'FAILED',
      actor: 'ADMIN',
      actorId: user.id,
      actorRole: user.roleCode,
      reason: dto.reason,
    });
    return { reportCode: updated.reportCode, status: updated.status };
  }

  /** Mencoba ulang pelaporan setelah gagal; retry_count bertambah (baris 22). */
  @Post(':reportCode/retry-submission')
  @RequirePermissions('report.fulfill')
  async retry(
    @Param('reportCode') reportCode: string,
    @Body() dto: FailReportDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const report = await this.reports.resolveAnyReport(reportCode);
    const updated = await this.transitions.transition({
      reportId: report.id,
      to: 'SUBMITTED',
      actor: 'ADMIN',
      actorId: user.id,
      actorRole: user.roleCode,
      reason: dto.reason,
      extraGuards: ['COMPLAINT_SUBMISSION'],
    });
    return { reportCode: updated.reportCode, status: updated.status, retryCount: updated.retryCount };
  }

  @Post(':reportCode/cancel')
  @RequirePermissions('report.fulfill')
  async cancel(
    @Param('reportCode') reportCode: string,
    @Body() dto: FailReportDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const report = await this.reports.resolveAnyReport(reportCode);
    const updated = await this.transitions.transition({
      reportId: report.id,
      to: 'CANCELLED',
      actor: 'ADMIN',
      actorId: user.id,
      actorRole: user.roleCode,
      reason: dto.reason,
    });
    return { reportCode: updated.reportCode, status: updated.status };
  }

  /** Soft archive sesuai kebijakan retensi (baris 24). */
  @Post(':reportCode/archive')
  @RequirePermissions('report.fulfill')
  async archive(
    @Param('reportCode') reportCode: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const report = await this.reports.resolveAnyReport(reportCode);
    const updated = await this.transitions.transition({
      reportId: report.id,
      to: 'ARCHIVED',
      actor: 'ADMIN',
      actorId: user.id,
      actorRole: user.roleCode,
    });
    return { reportCode: updated.reportCode, status: updated.status };
  }
}
