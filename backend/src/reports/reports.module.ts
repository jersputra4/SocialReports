import { Module } from '@nestjs/common';
import { LegalModule } from '../legal/legal.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PlatformsModule } from '../platforms/platforms.module';
import { PoliciesModule } from '../policies/policies.module';
import { PricingModule } from '../pricing/pricing.module';
import { AdminReportsController } from './admin-reports.controller';
import { ReportStatsService } from './report-stats.service';
import { ReportTransitionService } from './report-transition.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ReviewService } from './review.service';

@Module({
  imports: [PricingModule, PoliciesModule, LegalModule, PlatformsModule, NotificationsModule],
  controllers: [ReportsController, AdminReportsController],
  providers: [ReportsService, ReportTransitionService, ReviewService, ReportStatsService],
  exports: [ReportsService, ReportTransitionService, ReviewService],
})
export class ReportsModule {}
