import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDate,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Public, RequirePermissions, RequireStepUpMfa } from '../common/security/decorators';
import { LegalService } from './legal.service';

class ParagraphDto {
  @IsString() @MaxLength(32) number!: string;
  @IsString() @MinLength(5) text!: string;
  @IsOptional() @IsString() explanation?: string;
}

class CreateLawDto {
  @IsString() @MaxLength(64) code!: string;
  @IsString() @MaxLength(256) name!: string;
  @IsOptional() @IsString() @MaxLength(128) shortName?: string;
  @IsString() @MaxLength(64) version!: string;
  @Type(() => Date) @IsDate() effectiveFrom!: Date;
}

class AddArticleDto {
  @IsUUID() legalVersionId!: string;
  @IsString() @MaxLength(32) number!: string;
  @IsOptional() @IsString() @MaxLength(256) title?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ParagraphDto)
  paragraphs!: ParagraphDto[];
}

/**
 * Katalog dasar hukum.
 *
 * Kedua endpoint bersifat publik karena isinya teks undang-undang — dokumen
 * yang memang terbuka untuk umum, tanpa satu pun data pribadi. Halaman
 * panduan pelapor membacanya sebelum orang mendaftar, dan panduan paling
 * berguna justru pada saat itu: ketika seseorang masih menimbang apakah
 * kasusnya punya dasar hukum sama sekali.
 *
 * Keduanya hanya membaca, dan tetap dibatasi laju oleh reverse proxy.
 */
@Controller('legal')
export class LegalController {
  constructor(private readonly legal: LegalService) {}

  @Get('laws')
  @Public()
  listLaws() {
    return this.legal.listLaws();
  }

  @Get('versions/:versionId/articles')
  @Public()
  listArticles(@Param('versionId') versionId: string) {
    return this.legal.listArticles(versionId);
  }
}

@Controller('admin/legal')
export class LegalAdminController {
  constructor(private readonly legal: LegalService) {}

  @Get()
  @RequirePermissions('legal.manage')
  listAll() {
    return this.legal.listAllForAdmin();
  }

  @Post('laws')
  @RequirePermissions('legal.manage')
  @RequireStepUpMfa()
  createLaw(@Body() dto: CreateLawDto) {
    return this.legal.createLaw(dto);
  }

  @Post('articles')
  @RequirePermissions('legal.manage')
  @RequireStepUpMfa()
  addArticle(@Body() dto: AddArticleDto) {
    return this.legal.addArticle(dto);
  }

  @Post('laws/:lawId/archive')
  @RequirePermissions('legal.manage')
  @RequireStepUpMfa()
  async archive(@Param('lawId') lawId: string) {
    await this.legal.archiveLaw(lawId);
    return { message: 'Dasar hukum diarsipkan.' };
  }
}
