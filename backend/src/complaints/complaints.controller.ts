import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { AuthenticatedUser } from '../common/security/auth.types';
import { CurrentUser, RequirePermissions } from '../common/security/decorators';
import { SubmitToPlatformDto } from '../reports/dto/report.dto';
import { ComplaintsService } from './complaints.service';

@Controller('admin/reports/:reportCode/submissions')
export class ComplaintsController {
  constructor(private readonly complaints: ComplaintsService) {}

  /**
   * Mencatat bahwa report sudah dilaporkan ke platform lewat jalur resmi,
   * sekaligus memindahkan status ke SUBMITTED (BRD 7.2 baris 18).
   */
  @Post()
  @RequirePermissions('report.fulfill')
  submit(
    @Param('reportCode') reportCode: string,
    @Body() dto: SubmitToPlatformDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.complaints.submitToPlatform({
      reportCode,
      channel: dto.channel,
      externalReference: dto.externalReference,
      notes: dto.notes,
      adminId: user.id,
      adminRole: user.roleCode,
    });
  }

  @Get()
  @RequirePermissions('report.review')
  list(@Param('reportCode') reportCode: string) {
    return this.complaints.listForReport(reportCode);
  }
}
