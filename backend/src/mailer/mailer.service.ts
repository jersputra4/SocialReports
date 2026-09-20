import { Inject, Injectable, Logger } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';
import { AppConfig, CONFIG_TOKEN } from '../common/config/configuration';
import { PrismaService } from '../common/prisma/prisma.service';
import { maskEmail } from '../common/utils/sanitize.util';
import { describeAttachments, prepareAttachments } from './mail-attachments';
import { MailContent } from './mail-templates';

/** Hasil pengiriman; `messageId` dipakai sebagai acuan kiriman resmi. */
export interface MailSendResult {
  messageId: string | null;
  attachmentCount: number;
}

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

  /**
   * Mengirim satu email.
   *
   * Lampiran dibersihkan lebih dulu oleh `prepareAttachments`: nama dirapikan,
   * nama ganda dibedakan, dan ukuran total diperiksa. Bila melewati batas,
   * fungsi ini melempar `AttachmentTooLargeError` sebelum menyentuh jaringan,
   * sehingga pemanggil dapat mencatat kegagalan yang jelas alih-alih menunggu
   * penolakan dari server tujuan.
   */
  async send(to: string, content: MailContent): Promise<MailSendResult> {
    const attachments =
      content.attachments && content.attachments.length > 0
        ? prepareAttachments(content.attachments)
        : [];

    const jumlah = attachments.length > 0 ? ` (${attachments.length} lampiran)` : '';

    if (this.config.mail.driver === 'smtp' && this.transporter) {
      const info = await this.transporter.sendMail({
        from: this.config.mail.from,
        to,
        subject: content.subject,
        text: content.text,
        html: content.html,
        attachments: attachments.length > 0 ? attachments : undefined,
      });

      this.logger.log(`Email "${content.subject}" terkirim ke ${maskEmail(to)}${jumlah}`);
      return {
        messageId: typeof info?.messageId === 'string' ? info.messageId : null,
        attachmentCount: attachments.length,
      };
    }

    // Driver mailbox tidak mengirim apa pun dan tidak menyimpan isi lampiran.
    // Daftar nama dan ukurannya tetap dicatat agar alur dapat diperiksa.
    const mail = await this.prisma.devMailbox.create({
      data: {
        toAddress: to,
        subject: content.subject,
        bodyText: `${content.text}${describeAttachments(attachments)}`,
        bodyHtml: content.html,
        highlight: content.highlight?.slice(0, 128),
      },
      select: { id: true },
    });

    this.logger.log(
      `Email "${content.subject}" masuk kotak lokal untuk ${maskEmail(to)}${jumlah}`,
    );
    return { messageId: `mailbox:${mail.id}`, attachmentCount: attachments.length };
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
