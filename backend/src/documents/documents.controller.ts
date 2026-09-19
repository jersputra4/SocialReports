import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { AuthenticatedUser } from '../common/security/auth.types';
import { CurrentUser } from '../common/security/decorators';
import { JobName, QueueName, QueueService } from '../common/queue/queue.service';
import { ReportsService } from '../reports/reports.service';
import { DocumentsService } from './documents.service';

class GeneratePdfDto {
  /** Melampirkan bukti pengerjaan sebagai lampiran opsional (BRD 8.3). */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === 1 || value === '1')
  @IsBoolean()
  includeProofs?: boolean;
}

@Controller()
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly reports: ReportsService,
    private readonly queue: QueueService,
  ) {}

  @Get('reports/:reportCode/documents')
  list(@Param('reportCode') reportCode: string, @CurrentUser() user: AuthenticatedUser) {
    return this.documents.listForReport(reportCode, user.id, user.isStaff);
  }

  /**
   * Meminta pembuatan PDF. Pekerjaan dijalankan worker secara asinkron
   * (NFR-04), sehingga permintaan HTTP tidak menunggu proses render.
   */
  @Post('reports/:reportCode/documents')
  async generate(
    @Param('reportCode') reportCode: string,
    @Body() dto: GeneratePdfDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const report = user.isStaff
      ? await this.reports.resolveAnyReport(reportCode)
      : await this.reports.resolveOwnedReport(user.id, reportCode);

    await this.queue.enqueue(QueueName.DOCUMENTS, JobName.GENERATE_REPORT_PDF, {
      reportId: report.id,
      includeProofs: dto.includeProofs ?? false,
      actorId: user.id,
      actorRole: user.roleCode,
    });

    return {
      message: 'Pembuatan PDF sedang diproses. Versi baru akan muncul di daftar dokumen.',
      accepted: true,
    };
  }

  @Get('documents/:documentId/download-url')
  downloadUrl(@Param('documentId') documentId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.documents.downloadUrl(documentId, user.id, user.isStaff);
  }
}
