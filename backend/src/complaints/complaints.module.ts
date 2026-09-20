import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReportsModule } from '../reports/reports.module';
import { ComplaintsController } from './complaints.controller';
import { ComplaintsService } from './complaints.service';
import { KomdigiController } from './komdigi.controller';
import { KomdigiForwardService } from './komdigi-forward.service';

@Module({
  imports: [ReportsModule, NotificationsModule, DocumentsModule],
  controllers: [ComplaintsController, KomdigiController],
  providers: [ComplaintsService, KomdigiForwardService],
  exports: [ComplaintsService, KomdigiForwardService],
})
export class ComplaintsModule {}
