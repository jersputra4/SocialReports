import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AppConfigModule } from './common/config/config.module';
import { AuditModule } from './common/audit/audit.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { QueueModule } from './common/queue/queue.module';
import { RedisModule } from './common/redis/redis.module';
import { SecurityModule } from './common/security/security.module';
import { UploadsModule } from './common/uploads/uploads.module';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';

import { CsrfGuard } from './common/security/csrf.guard';
import { PermissionsGuard } from './common/security/permissions.guard';
import { RateLimitGuard } from './common/security/rate-limit.guard';
import { SessionGuard } from './common/security/session.guard';
import { StepUpMfaGuard } from './common/security/step-up.guard';

import { MailerModule } from './mailer/mailer.module';
import { StorageModule } from './storage/storage.module';
import { FetcherClientModule } from './fetcher-client/fetcher-client.module';

import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { PlatformsModule } from './platforms/platforms.module';
import { PoliciesModule } from './policies/policies.module';
import { LegalModule } from './legal/legal.module';
import { PricingModule } from './pricing/pricing.module';
import { ReportsModule } from './reports/reports.module';
import { EvidencesModule } from './evidences/evidences.module';
import { ProofsModule } from './proofs/proofs.module';
import { PaymentsModule } from './payments/payments.module';
import { DocumentsModule } from './documents/documents.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ComplaintsModule } from './complaints/complaints.module';
import { AuditApiModule } from './audit/audit-api.module';
import { HealthModule } from './health/health.module';
import { DevModule } from './dev/dev.module';

/**
 * Susunan modul aplikasi.
 *
 * Guard dipasang global dan urutannya penting:
 *   1. SessionGuard    — menentukan siapa pemanggilnya
 *   2. CsrfGuard       — menolak permintaan lintas situs yang mengubah data
 *   3. RateLimitGuard  — membatasi laju setelah identitas diketahui
 *   4. PermissionsGuard— memeriksa izin yang dituntut endpoint
 *   5. StepUpMfaGuard  — menuntut OTP ulang untuk aksi sensitif
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

    AuthModule,
    UsersModule,
    PlatformsModule,
    PoliciesModule,
    LegalModule,
    PricingModule,
    ReportsModule,
    EvidencesModule,
    ProofsModule,
    PaymentsModule,
    DocumentsModule,
    NotificationsModule,
    ComplaintsModule,
    AuditApiModule,
    HealthModule,
    DevModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: StepUpMfaGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
