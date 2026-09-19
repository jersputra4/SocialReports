import { Body, Controller, Get, Patch } from '@nestjs/common';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { AuditAction } from '../common/audit/audit-actions';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthenticatedUser } from '../common/security/auth.types';
import { CurrentUser } from '../common/security/decorators';

class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  fullName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9+\-\s()]{6,32}$/, { message: 'Format nomor telepon tidak valid.' })
  phone?: string;
}

/**
 * Setting akun.
 *
 * Alamat email TIDAK dapat diubah di sini (asumsi A-06 pada BRD): perubahan
 * email hanya lewat proses admin dengan verifikasi identitas, karena MFA
 * sistem ini bersandar pada mailbox pengguna.
 */
@Controller('me')
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('profile')
  async profile(@CurrentUser() user: AuthenticatedUser) {
    const row = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        email: true,
        fullName: true,
        phone: true,
        status: true,
        mfaEnabled: true,
        emailVerifiedAt: true,
        lastLoginAt: true,
        createdAt: true,
        role: { select: { code: true, name: true } },
      },
    });

    return {
      ...row,
      emailChangeable: false,
      emailChangeNote:
        'Alamat email tidak dapat diubah sendiri karena dipakai untuk verifikasi masuk. Hubungi administrator bila perlu diganti.',
    };
  }

  @Patch('profile')
  async update(@Body() dto: UpdateProfileDto, @CurrentUser() user: AuthenticatedUser) {
    const before = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { fullName: true, phone: true },
    });

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        fullName: dto.fullName?.trim() ?? before.fullName,
        phone: dto.phone ?? before.phone,
      },
      select: { fullName: true, phone: true },
    });

    await this.audit.record({
      action: AuditAction.USER_UPDATE,
      entityType: 'user',
      entityId: user.id,
      actorId: user.id,
      before,
      after: updated,
    });

    return updated;
  }

  @Get('sessions')
  async sessions(@CurrentUser() user: AuthenticatedUser) {
    const rows = await this.prisma.userSession.findMany({
      where: { userId: user.id, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
        lastSeenAt: true,
        idleExpiresAt: true,
        absoluteExpiresAt: true,
      },
    });

    return rows.map((row) => ({ ...row, current: row.id === user.sessionId }));
  }
}
