import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { AppConfig, CONFIG_TOKEN } from '../common/config/configuration';
import { JobName, QueueName } from '../common/queue/queue.service';
import { DocumentsService } from '../documents/documents.service';
import { PaymentsService } from '../payments/payments.service';
import { OutboxDispatcherService } from './outbox-dispatcher.service';

/**
 * Pendaftaran worker BullMQ.
 *
 * Setiap pekerjaan di sini idempoten: memproses ulang job yang sama tidak
 * menghasilkan efek ganda. Itu yang membuat percobaan ulang otomatis aman.
 */
@Injectable()
export class JobProcessorsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobProcessorsService.name);
  private readonly workers: Worker[] = [];

  constructor(
    private readonly payments: PaymentsService,
    private readonly documents: DocumentsService,
    private readonly dispatcher: OutboxDispatcherService,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    this.workers.push(
      this.createWorker(QueueName.PAYMENTS, async (job) => {
        if (job.name !== JobName.PROCESS_WEBHOOK) return;
        await this.payments.processWebhookEvent(job.data.webhookEventId as string);
      }),
    );

    this.workers.push(
      this.createWorker(
        QueueName.DOCUMENTS,
        async (job) => {
          if (job.name !== JobName.GENERATE_REPORT_PDF) return;
          await this.documents.generateReportPdf({
            reportId: job.data.reportId as string,
            includeProofs: Boolean(job.data.includeProofs),
            actorId: (job.data.actorId as string) ?? null,
            actorRole: (job.data.actorRole as string) ?? null,
          });
        },
        2, // render PDF berat; batasi paralelismenya
      ),
    );

    this.workers.push(
      this.createWorker(QueueName.OUTBOX, async (job) => {
        if (job.name !== JobName.DISPATCH_OUTBOX) return;
        await this.dispatcher.dispatchById(job.data.eventId as string);
      }),
    );

    this.logger.log(`${this.workers.length} worker antrean aktif.`);
  }

  private createWorker(
    queueName: string,
    handler: (job: Job) => Promise<void>,
    concurrency = 5,
  ): Worker {
    const worker = new Worker(
      queueName,
      async (job) => {
        const started = Date.now();
        await handler(job);
        this.logger.log(
          `Job ${queueName}/${job.name} (${job.id}) selesai dalam ${Date.now() - started} ms`,
        );
      },
      {
        connection: { url: this.config.redisUrl },
        concurrency,
      },
    );

    worker.on('failed', (job, error) => {
      this.logger.error(
        `Job ${queueName}/${job?.name} (${job?.id}) gagal: ${error.message}`,
        error.stack,
      );
    });

    return worker;
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.workers.map((worker) => worker.close().catch(() => undefined)));
  }
}
