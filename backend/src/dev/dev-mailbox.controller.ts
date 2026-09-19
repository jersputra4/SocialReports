import { Controller, ForbiddenException, Get, Inject, Query } from '@nestjs/common';
import { AppConfig, CONFIG_TOKEN } from '../common/config/configuration';
import { PrismaService } from '../common/prisma/prisma.service';
import { Public } from '../common/security/decorators';

/**
 * Kotak masuk email lokal.
 *
 * Hanya aktif ketika MAIL_DRIVER=mailbox dan bukan production. Gunanya agar
 * alur verifikasi email, OTP, dan reset kata sandi dapat dicoba sepenuhnya di
 * mesin sendiri tanpa penyedia email dan tanpa menaruh OTP di log aplikasi.
 *
 * Pada konfigurasi production dengan driver smtp, endpoint ini menolak semua
 * permintaan.
 */
@Controller('dev/mailbox')
export class DevMailboxController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
  ) {}

  private assertEnabled(): void {
    if (this.config.isProduction || this.config.mail.driver !== 'mailbox') {
      throw new ForbiddenException('Kotak masuk lokal tidak aktif pada konfigurasi ini.');
    }
  }

  @Public()
  @Get()
  async list(@Query('to') to?: string, @Query('limit') limit?: string) {
    this.assertEnabled();
    const take = Math.min(50, Math.max(1, Number.parseInt(limit ?? '20', 10) || 20));

    const rows = await this.prisma.devMailbox.findMany({
      where: to ? { toAddress: to.toLowerCase() } : undefined,
      orderBy: { createdAt: 'desc' },
      take,
    });

    return rows.map((row) => ({
      id: row.id,
      to: row.toAddress,
      subject: row.subject,
      highlight: row.highlight,
      bodyText: row.bodyText,
      createdAt: row.createdAt,
    }));
  }

  /** Mengambil OTP atau token terakhir untuk satu alamat — mempercepat uji coba. */
  @Public()
  @Get('latest')
  async latest(@Query('to') to: string) {
    this.assertEnabled();

    const row = await this.prisma.devMailbox.findFirst({
      where: { toAddress: to.toLowerCase() },
      orderBy: { createdAt: 'desc' },
    });

    if (!row) return { found: false };

    return {
      found: true,
      subject: row.subject,
      highlight: row.highlight,
      createdAt: row.createdAt,
    };
  }
}
