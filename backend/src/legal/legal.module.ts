import { Module } from '@nestjs/common';
import { LegalAdminController, LegalController } from './legal.controller';
import { LegalService } from './legal.service';

@Module({
  controllers: [LegalController, LegalAdminController],
  providers: [LegalService],
  exports: [LegalService],
})
export class LegalModule {}
