import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CreateReportDto {
  @IsUUID(undefined, { message: 'Jenis tindakan tidak valid.' })
  actionTypeId!: string;

  @IsUUID(undefined, { message: 'Paket tidak valid.' })
  packageId!: string;

  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true },
    { message: 'URL target harus berupa tautan http/https yang lengkap.' },
  )
  @MaxLength(2048)
  targetUrl!: string;

  @IsOptional()
  @IsString()
  @MinLength(50, {
    message: 'Kronologi kejadian minimal 50 karakter.',
  })
  @MaxLength(2000)
  description?: string;
}

export class UpdateReportDto {
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  targetUrl?: string;

  @IsOptional()
  @IsString()
  @MinLength(50, {
    message: 'Kronologi kejadian minimal 50 karakter.',
  })
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsUUID()
  packageId?: string;

  @IsOptional()
  @IsUUID()
  actionTypeId?: string;
}

export class PolicySelectionDto {
  @IsOptional()
  @IsUUID()
  policyVersionId?: string;

  /** Diisi bila pengguna memilih "Lainnya". */
  @IsOptional()
  @IsString()
  @MinLength(20, { message: 'Jelaskan alasan minimal 20 karakter.' })
  @MaxLength(2000)
  otherReason?: string;
}

export class SetPoliciesDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Pilih minimal satu kebijakan platform.' })
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => PolicySelectionDto)
  policies!: PolicySelectionDto[];
}

export class LegalSelectionDto {
  @IsOptional()
  @IsUUID()
  paragraphId?: string;

  @IsOptional()
  @IsString()
  @MinLength(20, { message: 'Jelaskan alasan minimal 20 karakter.' })
  @MaxLength(2000)
  otherReason?: string;
}

export class SetLegalBasisDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Pilih minimal satu dasar hukum.' })
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => LegalSelectionDto)
  legalBasis!: LegalSelectionDto[];
}

export class CheckoutDto {
  /** Versi dokumen "tanpa refund" yang disetujui pengguna (BRD 6.4). */
  @IsString()
  @MaxLength(32)
  noRefundConsentVersion!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  paymentMethod?: string;
}

export class CancelReportDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ReviewDecisionDto {
  @IsIn(['APPROVED', 'REJECTED', 'NEEDS_REVISION'], {
    message: 'Keputusan harus APPROVED, REJECTED, atau NEEDS_REVISION.',
  })
  decision!: 'APPROVED' | 'REJECTED' | 'NEEDS_REVISION';

  @IsString()
  @MinLength(10, { message: 'Alasan wajib diisi minimal 10 karakter.' })
  @MaxLength(4000)
  reason!: string;

  @IsOptional()
  checklist?: Record<string, boolean>;
}

export class SubmitToPlatformDto {
  @IsIn(['IN_APP_FORM', 'EMAIL', 'WEB_FORM', 'LAW_ENFORCEMENT_PORTAL'])
  channel!: 'IN_APP_FORM' | 'EMAIL' | 'WEB_FORM' | 'LAW_ENFORCEMENT_PORTAL';

  @IsOptional()
  @IsString()
  @MaxLength(256)
  externalReference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class FailReportDto {
  @IsString()
  @MinLength(10, { message: 'Alasan wajib diisi minimal 10 karakter.' })
  @MaxLength(2000)
  reason!: string;
}

export class ListReportsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  pageSize?: number;
}
