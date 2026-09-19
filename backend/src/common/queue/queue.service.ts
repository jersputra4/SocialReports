import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { AppConfig, CONFIG_TOKEN } from '../config/configuration';

export const QueueName = {
  PAYMENTS: 'payments',
  DOCUMENTS: 'documents',
  SCANS: 'scans',
  OUTBOX: 'outbox',
} as const;

export const JobName = {
  PROCESS_WEBHOOK: 'process-webhook',
  GENERATE_REPORT_PDF: 'generate-report-pdf',
  SCAN_UPLOAD: 'scan-upload',
  DISPATCH_OUTBOX: 'dispatch-outbox',
} as const;

/**
 * Antrean pekerjaan asinkron (BullMQ di atas Redis).
 *
 * Antrean ini mempercepat pengambilan pekerjaan, tetapi bukan sumber
 * kebenaran: pekerjaan yang hilang dari Redis tetap dapat dibangun ulang dari
 * tabel `webhook_events`, `outbox_events`, dan status berkas di database
 * (BRD 3.4). Worker menjalankan pemindai berkala untuk itu.
 */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly queues = new Map<string, Queue>();

  constructor(@Inject(CONFIG_TOKEN) private readonly config: AppConfig) {}

  queue(name: string): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, {
        connection: { url: this.config.redisUrl },
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 2_000 },
          removeOnComplete: { age: 3_600, count: 1_000 },
          removeOnFail: { age: 86_400 },
        },
      });
      this.queues.set(name, queue);
    }
    return queue;
  }

  /**
   * Menambahkan pekerjaan. Kegagalan Redis tidak menjatuhkan permintaan HTTP —
   * pekerjaan akan diambil pemindai berkala di worker.
   */
  async enqueue(
    queueName: string,
    jobName: string,
    data: Record<string, unknown>,
    options?: { jobId?: string; delay?: number },
  ): Promise<void> {
    try {
      await this.queue(queueName).add(jobName, data, options);
    } catch (error) {
      this.logger.warn(
        `Gagal menambahkan job ${jobName} ke antrean ${queueName}: ${(error as Error).message}. ` +
          'Pekerjaan akan diambil pemindai berkala.',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.queues.values()].map((queue) => queue.close().catch(() => undefined)));
  }
}
