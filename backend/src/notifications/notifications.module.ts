import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { OutboxService } from './outbox.service';

@Module({
  controllers: [NotificationsController],
  providers: [OutboxService],
  exports: [OutboxService],
})
export class NotificationsModule {}
