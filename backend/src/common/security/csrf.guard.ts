import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppConfig, CONFIG_TOKEN } from '../config/configuration';
import { safeEqual } from '../utils/crypto.util';
import { AuthenticatedRequest } from './auth.types';
import { IS_PUBLIC_KEY, SKIP_CSRF_KEY } from './decorators';
import { SessionService } from './session.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Perlindungan CSRF untuk permintaan yang mengubah data (BRD 4.3).
 *
 * Pola double submit: token disimpan pada sesi server dan pada cookie yang
 * dapat dibaca JavaScript. Penyerang di situs lain dapat memancing browser
 * mengirim cookie, tetapi tidak dapat membaca nilainya untuk dipasang sebagai
 * header — sehingga permintaan lintas situs gagal.
 *
 * SameSite=Lax sudah menutup sebagian besar kasus; header ini lapisan kedua
 * yang juga melindungi dari sub-domain yang tidak tepercaya.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (SAFE_METHODS.has(request.method)) return true;

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip || isPublic) return true;

    const token = request.cookies?.[this.config.session.cookieName];
    if (!token) throw new ForbiddenException('Sesi tidak ditemukan.');

    const expected = await this.sessions.csrfTokenFor(token);
    const provided = request.header('x-csrf-token');

    if (!expected || !provided || !safeEqual(expected, provided)) {
      throw new ForbiddenException('Token CSRF tidak valid.');
    }

    return true;
  }
}
