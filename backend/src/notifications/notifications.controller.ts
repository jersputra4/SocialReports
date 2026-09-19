import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AuditService } from '../common/audit/audit.service';
import { AuditAction } from '../common/audit/audit-actions';
import { AuthenticatedUser } from '../common/security/auth.types';
import { CurrentUser, RequirePermissions } from '../common/security/decorators';
import { JobName, QueueName, QueueService } from '../common/queue/queue.service';
import { OutboxService } from './outbox.service';

/**
 * Monitoring notifikasi (BRD 4.4, FR-13).
 *
 * Yang dipantau admin: antrean outbox, dead-letter queue, dan kemampuan
 * mencoba ulang secara manual. Setiap percobaan ulang manual tercatat di
 * audit log.
 */
@Controller('admin/notifications')
export class NotificationsController {
  constructor(
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
  ) {}

  @Get('stats')
  @RequirePermissions('notification.manage')
  stats() {
    return this.outbox.stats();
  }

  @Get('events')
  @RequirePermissions('notification.manage')
  async list(@Query('status') status?: string, @Query('limit') limit?: string) {
    const parsed = Number.parseInt(limit ?? '', 10);
    const events = await this.outbox.list(
      status as 'PENDING' | 'FAILED' | 'DEAD' | 'SENT' | undefined,
      Number.isFinite(parsed) ? Math.min(parsed, 200) : 50,
    );

    return events.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      status: event.status,
      attempts: event.attempts,
      nextAttemptAt: event.nextAttemptAt,
      lastError: event.lastError,
      createdAt: event.createdAt,
      dispatchedAt: event.dispatchedAt,
      payload: event.payloadJson,
      recentLogs: event.logs.map((log) => ({
        channel: log.channel,
        result: log.result,
        httpStatus: log.httpStatus,
        detail: log.detail,
        attempt: log.attempt,
        createdAt: log.createdAt,
      })),
    }));
  }

  /** Mengembalikan event dari DLQ ke antrean. */
  @Post('events/:eventId/retry')
  @RequirePermissions('notification.manage')
  async retry(@Param('eventId') eventId: string, @CurrentUser() user: AuthenticatedUser) {
    await this.outbox.retryDeadLetter(eventId);

    await this.audit.record({
      action: AuditAction.NOTIFICATION_RETRY,
      entityType: 'outbox_event',
      entityId: eventId,
      actorId: user.id,
      actorRole: user.roleCode,
      after: { manualRetry: true },
    });

    await this.queue.enqueue(QueueName.OUTBOX, JobName.DISPATCH_OUTBOX, { eventId });

    return { message: 'Event dikembalikan ke antrean pengiriman.' };
  }
}
