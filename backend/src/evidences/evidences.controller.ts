import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseFilePipeBuilder,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthenticatedUser } from '../common/security/auth.types';
import { CurrentUser, RateLimit, RequirePermissions } from '../common/security/decorators';
import { EvidencesService } from './evidences.service';

class UploadEvidenceDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  caption?: string;
}

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

@Controller()
export class EvidencesController {
  constructor(private readonly evidences: EvidencesService) {}

  @Post('reports/:reportCode/evidences')
  @RateLimit({ name: 'upload', limit: 30, windowSeconds: 3600 })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  upload(
    @Param('reportCode') reportCode: string,
    @Body() dto: UploadEvidenceDto,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addMaxSizeValidator({ maxSize: MAX_UPLOAD_BYTES, message: 'Ukuran berkas melebihi 5 MB.' })
        .build(),
    )
    file: Express.Multer.File,
  ) {
    return this.evidences.upload({
      userId: user.id,
      reportCode,
      file,
      caption: dto.caption,
    });
  }

  @Get('reports/:reportCode/evidences')
  list(@Param('reportCode') reportCode: string, @CurrentUser() user: AuthenticatedUser) {
    return this.evidences.list(user.id, reportCode);
  }

  @Get('evidences/:evidenceId/download-url')
  downloadUrl(@Param('evidenceId') evidenceId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.evidences.downloadUrl({
      evidenceId,
      requesterId: user.id,
      isStaff: user.permissions.includes('report.review') || user.permissions.includes('report.fulfill'),
    });
  }

  @Delete('evidences/:evidenceId')
  async remove(@Param('evidenceId') evidenceId: string, @CurrentUser() user: AuthenticatedUser) {
    await this.evidences.remove(user.id, evidenceId);
    return { message: 'Evidence dihapus.' };
  }

  @Get('admin/reports/:reportCode/evidences')
  @RequirePermissions('report.review')
  listForAdmin(@Param('reportCode') reportCode: string) {
    return this.evidences.listForAdmin(reportCode);
  }
}
