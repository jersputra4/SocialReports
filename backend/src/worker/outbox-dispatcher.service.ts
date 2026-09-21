import { Inject, Injectable, Logger } from '@nestjs/common';
import { OutboxEvent } from '@prisma/client';
import { AppConfig, CONFIG_TOKEN } from '../common/config/configuration';
import { PrismaService } from '../common/prisma/prisma.service';
import { signWebhook } from '../common/utils/crypto.util';
import { formatArticleReference } from '../documents/komdigi-letter.builder';
import { MailerService } from '../mailer/mailer.service';
import { MailTemplates } from '../mailer/mail-templates';
import { AdminNotifierService } from '../notifications/admin-notifier.service';
import { OutboxPayload } from '../notifications/outbox.service';

/**
 * Pengirim event outbox — BRD/SRS v1.1 §4.4.
 *
 * Alur pengiriman:
 *   1. event diambil dari tabel (sumber kebenaran, bukan dari Redis);
 *   2. dikirim ke n8n dengan HMAC-SHA256 atas timestamp + body;
 *   3. hasilnya dicatat di notification_logs;
 *   4. gagal -> backoff eksponensial, maksimal 8 percobaan, lalu masuk DLQ.
 *
 * Untuk PROOF_UPLOADED dan REPORT_COMPLETED, email ke pemilik report dikirim
 * langsung oleh backend (bukan lewat n8n) dengan payload minimal yang sama
 * (BRD 8.4, AC-32).
 */
@Injectable()
export class OutboxDispatcherService {
  private readonly logger = new Logger(OutboxDispatcherService.name);

  private static readonly USER_EMAIL_EVENTS = new Set(['PROOF_UPLOADED', 'REPORT_COMPLETED']);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    private readonly adminNotifier: AdminNotifierService,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
  ) {}

  /** Mengambil dan mengirim event yang sudah waktunya dicoba. */
  async dispatchDue(batchSize = 25): Promise<{ sent: number; failed: number }> {
    const due = await this.prisma.outboxEvent.findMany({
      where: {
        status: { in: ['PENDING', 'FAILED'] },
        nextAttemptAt: { lte: new Date() },
      },
      orderBy: { createdAt: 'asc' },
      take: batchSize,
    });

    let sent = 0;
    let failed = 0;

    for (const event of due) {
      const ok = await this.dispatchOne(event);
      if (ok) sent += 1;
      else failed += 1;
    }

    return { sent, failed };
  }

  async dispatchById(eventId: string): Promise<boolean> {
    const event = await this.prisma.outboxEvent.findUnique({ where: { id: eventId } });
    if (!event) return false;
    if (event.status === 'SENT') return true;
    return this.dispatchOne(event);
  }

  private async dispatchOne(event: OutboxEvent): Promise<boolean> {
    const payload = event.payloadJson as unknown as OutboxPayload;
    const attempt = event.attempts + 1;

    const n8nResult = await this.deliverToN8n(payload, attempt, event.id);

    let emailOk = true;
    if (OutboxDispatcherService.USER_EMAIL_EVENTS.has(event.eventType)) {
      emailOk = await this.notifyReportOwner(event, payload, attempt);
    }

    // Notifikasi admin sengaja TIDAK ikut menentukan keberhasilan event.
    //
    // Kanal pesan di luar sistem — Telegram, WhatsApp — bisa mati berjam-jam
    // karena alasan yang tidak ada hubungannya dengan report. Bila kegagalan
    // kanal itu menahan event, seluruh rantai notifikasi lain ikut tertunda
    // dan akhirnya masuk dead-letter queue. Kegagalan tetap tercatat di
    // notification_logs supaya dapat ditelusuri.
    await this.notifyAdminChannel(event, attempt);

    if (n8nResult.ok && emailOk) {
      await this.prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: 'SENT',
          attempts: attempt,
          dispatchedAt: new Date(),
          lastError: null,
        },
      });
      return true;
    }

    const reason = n8nResult.ok ? 'pengiriman email ke pengguna gagal' : n8nResult.detail;
    await this.scheduleRetry(event, attempt, reason);
    return false;
  }

  private async deliverToN8n(
    payload: OutboxPayload,
    attempt: number,
    eventId: string,
  ): Promise<{ ok: boolean; detail: string; httpStatus?: number }> {
    const body = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = signWebhook(this.config.notification.n8nHmacSecret, timestamp, body);
    const started = Date.now();

    try {
      const response = await fetch(this.config.notification.n8nWebhookUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-signature': signature,
          'x-timestamp': timestamp,
          // Dipakai n8n untuk deduplikasi (BRD 4.4).
          'x-event-id': payload.event_id,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });

      const detail = await response.text().catch(() => '');
      const ok = response.ok;

      await this.log({
        eventId,
        channel: 'N8N',
        target: this.config.notification.n8nWebhookUrl,
        ok,
        httpStatus: response.status,
        detail: detail.slice(0, 1000),
        attempt,
        durationMs: Date.now() - started,
      });

      return { ok, detail: detail.slice(0, 500), httpStatus: response.status };
    } catch (error) {
      const detail = (error as Error).message;
      await this.log({
        eventId,
        channel: 'N8N',
        target: this.config.notification.n8nWebhookUrl,
        ok: false,
        detail,
        attempt,
        durationMs: Date.now() - started,
      });
      return { ok: false, detail };
    }
  }

  private async notifyReportOwner(
    event: OutboxEvent,
    payload: OutboxPayload,
    attempt: number,
  ): Promise<boolean> {
    if (!event.reportId) return true;

    const report = await this.prisma.report.findUnique({
      where: { id: event.reportId },
      select: { reportCode: true, user: { select: { email: true } } },
    });
    if (!report) return true;

    const content =
      event.eventType === 'PROOF_UPLOADED'
        ? MailTemplates.proofUploaded(this.config.appName, report.reportCode, payload.link)
        : MailTemplates.reportCompleted(this.config.appName, report.reportCode, payload.link);

    const started = Date.now();
    const ok = await this.mailer.sendQuietly(report.user.email, content);

    await this.log({
      eventId: event.id,
      channel: 'EMAIL_USER',
      // Alamat email tidak ditulis penuh ke log notifikasi.
      target: 'pemilik report',
      ok,
      detail: ok ? 'terkirim' : 'gagal',
      attempt,
      durationMs: Date.now() - started,
    });

    return ok;
  }

  /**
   * Pemberitahuan ke kanal pesan admin.
   *
   * Detail report dibaca langsung dari basis data di sini, bukan diambil dari
   * payload outbox. Payload itu memang minimal dan harus tetap begitu: ia
   * dikirim ke zona Automation yang berada di luar kendali sistem. Notifikasi
   * admin tidak melewati zona itu, jadi isinya boleh lebih lengkap tanpa
   * melonggarkan apa pun yang sudah diputuskan.
   *
   * Identitas pelapor tidak pernah dibaca, apalagi dikirim.
   */
  private async notifyAdminChannel(event: OutboxEvent, attempt: number): Promise<void> {
    if (!event.reportId) return;
    if (!this.adminNotifier.handles(event.eventType)) return;
    if (!this.adminNotifier.isEnabled()) return;

    const report = await this.prisma.report.findUnique({
      where: { id: event.reportId },
      select: {
        reportCode: true,
        status: true,
        description: true,
        packageQuantity: true,
        platformNameSnapshot: true,
        actionType: { select: { name: true } },
        targetSnapshot: { select: { originalUrl: true, canonicalUrl: true } },
        policies: { select: { nameSnapshot: true, otherReason: true } },
        legalBasis: {
          select: {
            lawNameSnapshot: true,
            articleNumberSnapshot: true,
            paragraphNumberSnapshot: true,
            otherReason: true,
          },
        },
        _count: { select: { evidences: true } },
      },
    });
    if (!report) return;

    const policyLabels = report.policies.map(
      (policy) => policy.nameSnapshot || policy.otherReason || '',
    );

    const articleLabels = report.legalBasis.map((basis) => {
      if (!basis.articleNumberSnapshot && basis.otherReason) return basis.otherReason;
      const reference = formatArticleReference({
        articleNumber: basis.articleNumberSnapshot,
        paragraphNumber: basis.paragraphNumberSnapshot,
      });
      return `${basis.lawNameSnapshot} ${reference}`.trim();
    });

    const started = Date.now();
    const result = await this.adminNotifier.notify({
      reportCode: report.reportCode,
      status: report.status,
      targetUrl:
        report.targetSnapshot?.canonicalUrl ?? report.targetSnapshot?.originalUrl ?? null,
      platformName: report.platformNameSnapshot,
      actionTypeName: report.actionType?.name ?? null,
      policyLabels,
      articleLabels,
      description: report.description,
      packageQuantity: report.packageQuantity,
      evidenceCount: report._count.evidences,
      adminLink: `${this.config.publicUrl}/admin/report/${report.reportCode}`,
      occurredAt: event.createdAt,
    });

    const channel = this.adminNotifier.channel;
    if (!channel) return;

    await this.log({
      eventId: event.id,
      channel,
      // Nomor tujuan tidak pernah ditulis utuh ke log.
      target: this.adminNotifier.maskedTarget,
      ok: result.ok,
      httpStatus: result.httpStatus,
      detail: result.detail,
      attempt,
      durationMs: Date.now() - started,
    });

    if (!result.ok) {
      this.logger.warn(
        `Notifikasi admin gagal untuk ${report.reportCode} lewat ${channel}: ${result.detail}`,
      );
    }
  }

  /**
   * Backoff eksponensial: 1, 2, 4, 8, 16, 32, 64, 128 menit.
   * Setelah percobaan ke-8 event masuk dead-letter queue dan menunggu
   * tindakan manual admin (BRD 4.4).
   */
  private async scheduleRetry(event: OutboxEvent, attempt: number, reason: string): Promise<void> {
    const maxAttempts = this.config.notification.outboxMaxAttempts;

    if (attempt >= maxAttempts) {
      await this.prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: 'DEAD',
          attempts: attempt,
          lastError: `Gagal setelah ${attempt} percobaan: ${reason}`.slice(0, 1024),
        },
      });
      this.logger.error(
        `Event ${event.id} (${event.eventType}) masuk dead-letter queue setelah ${attempt} percobaan.`,
      );
      return;
    }

    const delayMinutes = Math.min(2 ** (attempt - 1), 240);
    await this.prisma.outboxEvent.update({
      where: { id: event.id },
      data: {
        status: 'FAILED',
        attempts: attempt,
        nextAttemptAt: new Date(Date.now() + delayMinutes * 60_000),
        lastError: reason.slice(0, 1024),
      },
    });

    this.logger.warn(
      `Event ${event.id} gagal (percobaan ${attempt}/${maxAttempts}); dicoba lagi dalam ${delayMinutes} menit.`,
    );
  }

  private async log(input: {
    eventId: string;
    channel: 'N8N' | 'EMAIL_USER' | 'TELEGRAM_ADMIN' | 'WHATSAPP_ADMIN';
    target: string;
    ok: boolean;
    httpStatus?: number;
    detail: string;
    attempt: number;
    durationMs: number;
  }): Promise<void> {
    await this.prisma.notificationLog
      .create({
        data: {
          eventId: input.eventId,
          channel: input.channel,
          target: input.target.slice(0, 256),
          result: input.ok ? 'SUCCESS' : 'FAILURE',
          httpStatus: input.httpStatus,
          detail: input.detail.slice(0, 1024),
          attempt: input.attempt,
          durationMs: input.durationMs,
        },
      })
      .catch(() => undefined);
  }
}
