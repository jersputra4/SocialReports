import { Inject, Injectable, Logger } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';
import { AppConfig, CONFIG_TOKEN } from '../common/config/configuration';
import { PrismaService } from '../common/prisma/prisma.service';
import { maskEmail } from '../common/utils/sanitize.util';
import { MailContent } from './mail-templates';

/**
 * Pengiriman email.
 *
 * OTP dan verifikasi email dikirim langsung oleh backend, TIDAK lewat n8n,
 * agar proses masuk tidak bergantung pada ketersediaan n8n (BRD 3.4).
 *
 * Dua driver:
 *   - `mailbox` (pengembangan): email disimpan ke tabel dev_mailbox dan dapat
 *     dibuka di /dev/mailbox pada antarmuka. Tidak ada email keluar.
 *   - `smtp` (produksi): penyedia email transaksional dengan SPF/DKIM/DMARC.
 *
 * Keduanya memakai antarmuka yang sama sehingga pergantian driver tidak
 * menyentuh kode pemanggil.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private transporter?: Transporter;

  constructor(
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {
    if (this.config.mail.driver === 'smtp') {
      this.transporter = createTransport({
        host: this.config.mail.smtpHost,
        port: this.config.mail.smtpPort,
        secure: this.config.mail.smtpPort === 465,
        auth: this.config.mail.smtpUser
          ? { user: this.config.mail.smtpUser, pass: this.config.mail.smtpPassword }
          : undefined,
      });
    }
  }

  async send(to: string, content: MailContent): Promise<void> {
    if (this.config.mail.driver === 'smtp' && this.transporter) {
      await this.transporter.sendMail({
        from: this.config.mail.from,
        to,
        subject: content.subject,
        text: content.text,
        html: content.html,
      });
      this.logger.log(`Email "${content.subject}" terkirim ke ${maskEmail(to)}`);
      return;
    }

    await this.prisma.devMailbox.create({
      data: {
        toAddress: to,
        subject: content.subject,
        bodyText: content.text,
        bodyHtml: content.html,
        highlight: content.highlight?.slice(0, 128),
      },
    });
    this.logger.log(`Email "${content.subject}" masuk kotak lokal untuk ${maskEmail(to)}`);
  }

  /**
   * Pengiriman yang tidak boleh menjatuhkan alur utama (mis. notifikasi user
   * setelah transisi status). Kegagalan dicatat lalu diabaikan; pengiriman
   * ulang ditangani outbox.
   */
  async sendQuietly(to: string, content: MailContent): Promise<boolean> {
    try {
      await this.send(to, content);
      return true;
    } catch (error) {
      this.logger.error(
        `Gagal mengirim "${content.subject}" ke ${maskEmail(to)}: ${(error as Error).message}`,
      );
      return false;
    }
  }
}
