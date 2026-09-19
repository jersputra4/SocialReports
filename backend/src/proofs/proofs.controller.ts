import {
  Body,
  Controller,
  Get,
  Param,
  ParseFilePipeBuilder,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AuthenticatedUser } from '../common/security/auth.types';
import {
  CurrentUser,
  RateLimit,
  RequirePermissions,
  RequireStepUpMfa,
} from '../common/security/decorators';
import { ProofsService } from './proofs.service';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const toBoolean = ({ value }: { value: unknown }) =>
  value === true || value === 'true' || value === '1' || value === 1;

class UploadProofDto {
  @IsIn(['POST_REPORTED', 'ACCOUNT_REPORTED', 'OTHER'], {
    message: 'Jenis bukti harus POST_REPORTED, ACCOUNT_REPORTED, atau OTHER.',
  })
  proofType!: 'POST_REPORTED' | 'ACCOUNT_REPORTED' | 'OTHER';

  @Type(() => Date)
  @IsDate({ message: 'Waktu pelaporan tidak valid.' })
  reportedAt!: Date;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Keterangan maksimal 500 karakter.' })
  caption?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Jumlah unit tercakup harus bilangan bulat.' })
  @IsPositive()
  unitsReported?: number;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  visibleToUser?: boolean;
}

class UpdateProofDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  caption?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  reportedAt?: Date;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  visibleToUser?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  unitsReported?: number;
}

class VoidProofDto {
  @IsString()
  @MinLength(10, { message: 'Alasan void wajib diisi minimal 10 karakter.' })
  @MaxLength(2000)
  reason!: string;
}

/** Endpoint admin — BRD 8.5. */
@Controller('admin/reports/:reportCode/proofs')
export class AdminProofsController {
  constructor(private readonly proofs: ProofsService) {}

  @Post()
  @RequirePermissions('report.fulfill')
  @RateLimit({ name: 'upload', limit: 60, windowSeconds: 3600 })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  upload(
    @Param('reportCode') reportCode: string,
    @Body() dto: UploadProofDto,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addMaxSizeValidator({ maxSize: MAX_UPLOAD_BYTES, message: 'Ukuran berkas melebihi 5 MB.' })
        .build(),
    )
    file: Express.Multer.File,
  ) {
    return this.proofs.upload({
      adminId: user.id,
      adminRole: user.roleCode,
      reportCode,
      file,
      proofType: dto.proofType,
      reportedAt: dto.reportedAt,
      caption: dto.caption,
      unitsReported: dto.unitsReported,
      visibleToUser: dto.visibleToUser ?? true,
    });
  }

  @Get()
  @RequirePermissions('report.fulfill')
  list(@Param('reportCode') reportCode: string) {
    return this.proofs.listForAdmin(reportCode);
  }

  @Patch(':proofId')
  @RequirePermissions('report.fulfill')
  update(
    @Param('proofId') proofId: string,
    @Body() dto: UpdateProofDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.proofs.update({
      adminId: user.id,
      adminRole: user.roleCode,
      proofId,
      ...dto,
    });
  }

  /** Void menuntut step-up MFA (BRD 4.3, AC-27). */
  @Post(':proofId/void')
  @RequirePermissions('report.fulfill')
  @RequireStepUpMfa()
  voidProof(
    @Param('proofId') proofId: string,
    @Body() dto: VoidProofDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.proofs.void({
      adminId: user.id,
      adminRole: user.roleCode,
      proofId,
      reason: dto.reason,
    });
  }
}

/** Endpoint pemilik report — hanya baca (BRD 8.3, AC-28). */
@Controller()
export class ProofsController {
  constructor(private readonly proofs: ProofsService) {}

  @Get('reports/:reportCode/proofs')
  list(@Param('reportCode') reportCode: string, @CurrentUser() user: AuthenticatedUser) {
    return this.proofs.listForUser(user.id, reportCode);
  }

  @Get('reports/:reportCode/proofs/:proofId/download-url')
  downloadUrl(@Param('proofId') proofId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.proofs.downloadUrl({
      proofId,
      requesterId: user.id,
      isStaff: user.permissions.includes('report.fulfill'),
    });
  }
}
