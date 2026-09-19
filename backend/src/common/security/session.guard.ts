import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppConfig, CONFIG_TOKEN } from '../config/configuration';
import { setActor } from '../context/request-context';
import { AuthenticatedRequest } from './auth.types';
import { IS_PUBLIC_KEY } from './decorators';
import { SessionService } from './session.service';

/**
 * Guard sesi global.
 *
 * Endpoint tanpa @Public() selalu menuntut sesi yang masih berlaku. Sesi yang
 * kedaluwarsa atau dicabut menghasilkan 401 dan cookie-nya tidak lagi berguna
 * karena pemeriksaan dilakukan di sisi server (AC-06).
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = request.cookies?.[this.config.session.cookieName];

    if (!token || typeof token !== 'string') {
      throw new UnauthorizedException('Sesi tidak ditemukan. Silakan masuk kembali.');
    }

    const user = await this.sessions.resolve(token);
    if (!user) {
      throw new UnauthorizedException('Sesi sudah berakhir. Silakan masuk kembali.');
    }

    request.user = user;
    setActor(user.id, user.roleCode);
    return true;
  }
}
