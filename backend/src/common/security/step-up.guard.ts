import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppConfig, CONFIG_TOKEN } from '../config/configuration';
import { AuthenticatedRequest } from './auth.types';
import { STEP_UP_KEY } from './decorators';

/**
 * Step-up MFA (BRD 4.3, AC-38).
 *
 * Aksi sensitif menuntut OTP yang diverifikasi dalam 10 menit terakhir pada
 * sesi yang sama. Sesi yang sudah lama terbuka tidak cukup: penyerang yang
 * meminjam perangkat yang tidak terkunci tetap tertahan di sini.
 *
 * Respons 428 memberi tahu frontend bahwa yang dibutuhkan adalah OTP baru,
 * bukan login ulang.
 */
@Injectable()
export class StepUpMfaGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<boolean>(STEP_UP_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    if (!user) throw new ForbiddenException('Akses ditolak.');

    const windowMs = this.config.session.stepUpWindowMinutes * 60_000;
    const verifiedAt = user.mfaVerifiedAt?.getTime();

    if (!verifiedAt || Date.now() - verifiedAt > windowMs) {
      throw new HttpException(
        {
          statusCode: HttpStatus.PRECONDITION_REQUIRED,
          error: 'StepUpMfaRequired',
          message: `Tindakan ini memerlukan verifikasi OTP ulang (maksimal ${this.config.session.stepUpWindowMinutes} menit terakhir).`,
        },
        HttpStatus.PRECONDITION_REQUIRED,
      );
    }

    return true;
  }
}
