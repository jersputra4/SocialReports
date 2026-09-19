import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminProofsController, ProofsController } from './proofs.controller';
import { ProofsService } from './proofs.service';

@Module({
  imports: [NotificationsModule],
  controllers: [AdminProofsController, ProofsController],
  providers: [ProofsService],
  exports: [ProofsService],
})
export class ProofsModule {}
