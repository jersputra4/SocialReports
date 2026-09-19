import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppConfig, CONFIG_TOKEN } from '../common/config/configuration';
import { PrismaService } from '../common/prisma/prisma.service';

/**
 * Daftar event — BRD/SRS v1.1 §4.4.
 */
export const OutboxEventType = {
  REPORT_CREATED: 'REPORT_CREATED',
  PAYMENT_SUBMITTED: 'PAYMENT_SUBMITTED',
  PAYMENT_VERIFIED: 'PAYMENT_VERIFIED',
  PAYMENT_EXPIRED: 'PAYMENT_EXPIRED',
  REPORT_APPROVED: 'REPORT_APPROVED',
  REPORT_REJECTED: 'REPORT_REJECTED',
  REPORT_NEEDS_REVISION: 'REPORT_NEEDS_REVISION',
  REPORT_SUBMITTED: 'REPORT_SUBMITTED',
  PROOF_UPLOADED: 'PROOF_UPLOADED',
  REPORT_COMPLETED: 'REPORT_COMPLETED',
  PDF_GENERATED: 'PDF_GENERATED',
  COMPLAINT_SUBMITTED: 'COMPLAINT_SUBMITTED',
  SYSTEM_ERROR: 'SYSTEM_ERROR',
} as const;

export type OutboxEventTypeValue = (typeof OutboxEventType)[keyof typeof OutboxEventType];

/**
 * Payload notifikasi — sengaja minimal (BRD 4.4, AC-31).
 *
 * TIDAK memuat URL target, isi evidence, isi pasal, nama, email, atau nomor
 * telepon. Kanal notifikasi (email admin, WhatsApp, Telegram) berada di luar
 * kendali sistem ini, jadi yang dikirim hanya penanda dan tautan yang tetap
 * menuntut login.
 */
export interface OutboxPayload {
  event_id: string;
  event_type: string;
  report_code: string | null;
  status: string | null;
  occurred_at: string;
  link: string;
}

/**
 * Transactional outbox.
 *
 * Event WAJIB ditulis dalam transaksi database yang sama dengan perubahan
 * datanya. Dengan begitu tidak mungkin terjadi "status berubah tetapi
 * notifikasi hilang" atau sebaliknya — dua kegagalan klasik ketika notifikasi
 * dikirim langsung dari dalam permintaan HTTP.
 *
 * Redis/BullMQ hanya mempercepat pengambilan; sumber kebenarannya tabel ini,
 * sehingga n8n yang mati hanya menunda notifikasi (BRD 3.4, AC-30).
 */
@Injectable()
export class OutboxService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
  ) {}

  async enqueue(
    input: {
      eventType: OutboxEventTypeValue;
      reportId?: string | null;
      reportCode?: string | null;
      status?: string | null;
    },
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const occurredAt = new Date();

    const event = await tx.outboxEvent.create({
      data: {
        eventType: input.eventType,
        reportId: input.reportId ?? null,
        // payload diisi setelah id diketahui agar event_id ikut di dalamnya
        payloadJson: {},
      },
      select: { id: true },
    });

    const payload: OutboxPayload = {
      event_id: event.id,
      event_type: input.eventType,
      report_code: input.reportCode ?? null,
      status: input.status ?? null,
      occurred_at: occurredAt.toISOString(),
      link: input.reportCode
        ? `${this.config.publicUrl}/report/${input.reportCode}`
        : this.config.publicUrl,
    };

    await tx.outboxEvent.update({
      where: { id: event.id },
      data: { payloadJson: payload as unknown as Prisma.InputJsonValue },
    });

    return event.id;
  }

  // ------------------------------------------------------------ monitoring --

  async stats() {
    const [pending, failed, dead, oldest] = await Promise.all([
      this.prisma.outboxEvent.count({ where: { status: 'PENDING' } }),
      this.prisma.outboxEvent.count({ where: { status: 'FAILED' } }),
      this.prisma.outboxEvent.count({ where: { status: 'DEAD' } }),
      this.prisma.outboxEvent.findFirst({
        where: { status: { in: ['PENDING', 'FAILED'] } },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ]);

    const backlogSeconds = oldest
      ? Math.floor((Date.now() - oldest.createdAt.getTime()) / 1000)
      : 0;

    return {
      pending,
      failed,
      dead,
      oldestBacklogSeconds: backlogSeconds,
      // NFR-11: alert bila backlog tertua > 5 menit atau DLQ > 0
      alerting: backlogSeconds > 300 || dead > 0,
      maxAttempts: this.config.notification.outboxMaxAttempts,
    };
  }

  async list(status: 'PENDING' | 'FAILED' | 'DEAD' | 'SENT' | undefined, take = 50) {
    return this.prisma.outboxEvent.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        logs: { orderBy: { createdAt: 'desc' }, take: 3 },
      },
    });
  }

  /**
   * Mengembalikan event dari DLQ ke antrean (BRD 4.4).
   * Setiap percobaan ulang manual dicatat di audit log oleh pemanggil.
   */
  async retryDeadLetter(eventId: string): Promise<void> {
    await this.prisma.outboxEvent.update({
      where: { id: eventId },
      data: {
        status: 'PENDING',
        attempts: 0,
        nextAttemptAt: new Date(),
        lastError: null,
      },
    });
  }
}
