import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AuthenticatedUser } from '../common/security/auth.types';
import { CurrentUser } from '../common/security/decorators';
import {
  CancelReportDto,
  CreateReportDto,
  ListReportsQueryDto,
  SetLegalBasisDto,
  SetPoliciesDto,
  UpdateReportDto,
} from './dto/report.dto';
import { ReportsService } from './reports.service';
import { allowedTargetsForActor, ReportStatusValue } from './state-machine';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post()
  create(@Body() dto: CreateReportDto, @CurrentUser() user: AuthenticatedUser) {
    return this.reports.createDraft(user.id, dto);
  }

  @Get()
  list(@Query() query: ListReportsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.reports.listForUser(user.id, query);
  }

  @Get(':reportCode')
  async detail(@Param('reportCode') reportCode: string, @CurrentUser() user: AuthenticatedUser) {
    const report = await this.reports.findForUser(user.id, reportCode);
    return {
      ...report,
      // Membantu antarmuka menampilkan tombol yang memang tersedia.
      availableActions: allowedTargetsForActor(report.status as ReportStatusValue, 'USER'),
    };
  }

  @Patch(':reportCode')
  update(
    @Param('reportCode') reportCode: string,
    @Body() dto: UpdateReportDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reports.update(user.id, reportCode, dto);
  }

  @Post(':reportCode/policies')
  setPolicies(
    @Param('reportCode') reportCode: string,
    @Body() dto: SetPoliciesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reports.setPolicies(user.id, reportCode, dto);
  }

  @Post(':reportCode/legal-basis')
  setLegalBasis(
    @Param('reportCode') reportCode: string,
    @Body() dto: SetLegalBasisDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reports.setLegalBasis(user.id, reportCode, dto);
  }

  /** Mengirim ulang setelah perbaikan — tanpa pembayaran baru (AC-22). */
  @Post(':reportCode/resubmit')
  resubmit(@Param('reportCode') reportCode: string, @CurrentUser() user: AuthenticatedUser) {
    return this.reports.resubmitAfterRevision(user.id, reportCode);
  }

  @Post(':reportCode/cancel')
  cancel(
    @Param('reportCode') reportCode: string,
    @Body() dto: CancelReportDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reports.cancel(user.id, reportCode, dto.reason);
  }
}
