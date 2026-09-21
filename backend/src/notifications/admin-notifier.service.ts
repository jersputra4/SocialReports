import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfig, CONFIG_TOKEN } from '../common/config/configuration';
import {
  AdminNotification,
  AdminNotificationInput,
  buildAdminNotification,
  maskDestination,
} from './admin-notification';

/**
 * Kanal notifikasi admin ke aplikasi pesan.
 *
 * Dua driver, satu antarmuka — pola yang sama dengan `MailerService`
 * (`mailbox` / `smtp`), supaya pemanggil tidak perlu tahu kanal mana yang
 * sedang aktif dan pergantian kanal tidak menyentuh kode pemanggil.
 *
 *   - `telegram`: Bot API. Bisa dipakai hari ini, tanpa pendaftaran template
 *     dan tanpa persetujuan pihak mana pun.
 *   - `whatsapp_cloud`: WhatsApp Business Platform resmi dari Meta. Pesan di
 *     luar jendela layanan 24 jam wajib memakai template `utility` yang sudah
 *     disetujui, jadi isinya dikirim sebagai parameter berurutan.
 *
 * Pustaka WhatsApp tidak resmi sengaja tidak dipakai: pustaka semacam itu
 * melanggar ketentuan layanan WhatsApp dan berisiko membuat nomor diblokir
 * permanen — kehilangan yang tidak sepadan untuk kanal pemberitahuan.
 *
 * Layanan ini berjalan di worker, yang tersambung ke zona data dan punya
 * jalan keluar ke internet. Zona Automation tidak dipakai di sini: jaringannya
 * `internal: true`, dan payload yang boleh masuk ke sana sengaja minimal.
 */
@Injectable()
export class AdminNotifierService {
  private readonly logger = new Logger(AdminNotifierService.name);

  constructor(@Inject(CONFIG_TOKEN) private readonly config: AppConfig) {}

  /** Nama kanal untuk `notification_logs`. */
  get channel(): 'TELEGRAM_ADMIN' | 'WHATSAPP_ADMIN' | null {
    switch (this.config.adminNotify.driver) {
      case 'telegram':
        return 'TELEGRAM_ADMIN';
      case 'whatsapp_cloud':
        return 'WHATSAPP_ADMIN';
      default:
        return null;
    }
  }

  /** Tujuan yang sudah disamarkan; dipakai untuk log, bukan untuk pengiriman. */
  get maskedTarget(): string {
    return maskDestination(this.rawTarget());
  }

  /**
   * Apakah kanal siap dipakai.
   *
   * Konfigurasi setengah jadi — driver dipilih tetapi token belum diisi —
   * diperlakukan sebagai mati, dengan peringatan sekali di log. Tanpa
   * pemeriksaan ini setiap event akan menghasilkan satu permintaan HTTP yang
   * pasti gagal, lalu delapan kali percobaan ulang outbox.
   */
  isEnabled(): boolean {
    const { driver, telegram, whatsapp } = this.config.adminNotify;
    if (driver === 'none') return false;

    if (driver === 'telegram') {
      const siap = telegram.botToken.length > 0 && telegram.chatId.length > 0;
      if (!siap) this.warnOnce('TELEGRAM_BOT_TOKEN dan TELEGRAM_CHAT_ID');
      return siap;
    }

    const siap =
      whatsapp.accessToken.length > 0 &&
      whatsapp.phoneNumberId.length > 0 &&
      whatsapp.recipient.length > 0;
    if (!siap) {
      this.warnOnce('WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID dan ADMIN_WHATSAPP_NUMBER');
    }
    return siap;
  }

  /** Apakah event ini termasuk yang memicu notifikasi admin. */
  handles(eventType: string): boolean {
    return this.config.adminNotify.events.includes(eventType);
  }

  /**
   * Mengirim satu notifikasi.
   *
   * Tidak pernah melempar: kegagalan dikembalikan sebagai hasil agar pemanggil
   * memutuskan sendiri apakah event perlu dicoba ulang.
   */
  async notify(
    input: AdminNotificationInput,
  ): Promise<{ ok: boolean; detail: string; httpStatus?: number }> {
    if (!this.isEnabled()) return { ok: true, detail: 'kanal admin tidak aktif' };

    const pesan = buildAdminNotification({
      ...input,
      excerptLength: input.excerptLength ?? this.config.adminNotify.excerptLength,
    });

    try {
      return this.config.adminNotify.driver === 'telegram'
        ? await this.sendTelegram(pesan)
        : await this.sendWhatsapp(pesan);
    } catch (error) {
      return { ok: false, detail: (error as Error).message.slice(0, 500) };
    }
  }

  // ------------------------------------------------------------- telegram --

  private async sendTelegram(
    pesan: AdminNotification,
  ): Promise<{ ok: boolean; detail: string; httpStatus: number }> {
    const { telegram } = this.config.adminNotify;
    const url = `https://api.telegram.org/bot${telegram.botToken}/sendMessage`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegram.chatId,
        text: pesan.text,
        // Pratinjau tautan dimatikan dengan sengaja. Bila dibiarkan menyala,
        // server Telegram akan mengambil sendiri isi URL target — artinya
        // konten yang sedang dilaporkan ikut diunduh oleh pihak ketiga, dan
        // gambarnya muncul di layar admin tanpa diminta.
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(this.config.adminNotify.timeoutMs),
    });

    const detail = await response.text().catch(() => '');
    return { ok: response.ok, detail: detail.slice(0, 500), httpStatus: response.status };
  }

  // ------------------------------------------------------------- whatsapp --

  private async sendWhatsapp(
    pesan: AdminNotification,
  ): Promise<{ ok: boolean; detail: string; httpStatus: number }> {
    const { whatsapp, timeoutMs } = this.config.adminNotify;
    const url = `https://graph.facebook.com/${whatsapp.graphVersion}/${whatsapp.phoneNumberId}/messages`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${whatsapp.accessToken}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: whatsapp.recipient,
        type: 'template',
        template: {
          name: whatsapp.templateName,
          language: { code: whatsapp.languageCode },
          components: [
            {
              type: 'body',
              parameters: pesan.parameters.map((text) => ({ type: 'text', text })),
            },
          ],
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const detail = await response.text().catch(() => '');
    return { ok: response.ok, detail: detail.slice(0, 500), httpStatus: response.status };
  }

  // -------------------------------------------------------------- bantuan --

  private rawTarget(): string {
    const { driver, telegram, whatsapp } = this.config.adminNotify;
    if (driver === 'telegram') return telegram.chatId;
    if (driver === 'whatsapp_cloud') return whatsapp.recipient;
    return '';
  }

  private warned = false;

  private warnOnce(variables: string): void {
    if (this.warned) return;
    this.warned = true;
    this.logger.warn(
      `ADMIN_NOTIFY_DRIVER diisi "${this.config.adminNotify.driver}" tetapi ${variables} masih kosong; ` +
        `notifikasi admin tidak dikirim.`,
    );
  }
}
