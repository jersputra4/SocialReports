import { Module } from '@nestjs/common';
import { AdminNotifierService } from './admin-notifier.service';
import { NotificationsController } from './notifications.controller';
import { OutboxService } from './outbox.service';

@Module({
  controllers: [NotificationsController],
  providers: [OutboxService, AdminNotifierService],
  exports: [OutboxService, AdminNotifierService],
})
export class NotificationsModule {}
