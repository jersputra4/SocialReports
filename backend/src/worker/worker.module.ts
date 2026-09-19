import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { AppConfigModule } from '../common/config/config.module';
import { AuditModule } from '../common/audit/audit.module';
import { PrismaModule } from '../common/prisma/prisma.module';
import { QueueModule } from '../common/queue/queue.module';
import { RedisModule } from '../common/redis/redis.module';
import { SecurityModule } from '../common/security/security.module';
import { UploadsModule } from '../common/uploads/uploads.module';
import { FetcherClientModule } from '../fetcher-client/fetcher-client.module';
import { MailerModule } from '../mailer/mailer.module';
import { StorageModule } from '../storage/storage.module';

import { DocumentsModule } from '../documents/documents.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { ReportsModule } from '../reports/reports.module';

import { JobProcessorsService } from './job-processors.service';
import { OutboxDispatcherService } from './outbox-dispatcher.service';
import { ScheduledTasksService } from './scheduled-tasks.service';

/**
 * Proses worker.
 *
 * Berjalan sebagai proses terpisah dari API (BRD 3.3) sehingga pekerjaan berat
 * — render PDF, pemindaian berkas, pengiriman notifikasi, rekonsiliasi — tidak
 * memengaruhi waktu tanggap permintaan pengguna (NFR-01, NFR-02).
 */
@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    RedisModule,
    QueueModule,
    SecurityModule,
    AuditModule,
    UploadsModule,
    StorageModule,
    MailerModule,
    FetcherClientModule,

    ReportsModule,
    PaymentsModule,
    DocumentsModule,
    NotificationsModule,

    ScheduleModule.forRoot(),
  ],
  providers: [OutboxDispatcherService, JobProcessorsService, ScheduledTasksService],
})
export class WorkerModule {}
