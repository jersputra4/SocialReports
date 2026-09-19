import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MfaService } from './mfa.service';
import { StartupSecurityCheck } from './startup-security.check';

@Module({
  controllers: [AuthController],
  providers: [AuthService, MfaService, StartupSecurityCheck],
  exports: [AuthService, MfaService],
})
export class AuthModule {}
