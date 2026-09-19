import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppConfig, CONFIG_TOKEN } from '../config/configuration';
import { RedisService } from '../redis/redis.service';
import { sha256Hex } from '../utils/crypto.util';
import { AuthenticatedRequest } from './auth.types';
import { RATE_LIMIT_KEY, RateLimitOptions } from './decorators';

/**
 * Rate limit per akun dan per IP (NFR-09, AC-03).
 *
 * Batas bawaan berlaku untuk seluruh endpoint; @RateLimit() menimpanya untuk
 * jalur yang lebih rawan seperti login, permintaan OTP, dan unggah berkas.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const override = this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const options: RateLimitOptions = override ?? {
      name: 'api',
      limit: this.config.rateLimit.apiPerMinute,
      windowSeconds: 60,
    };

    const subject = this.subjectFor(request, options);
    const key = `rl:${options.name}:${subject}`;

    const count = await this.redis.incrementWindow(key, options.windowSeconds);
    if (count > options.limit) {
      const retryAfter = await this.redis.ttl(key);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'TooManyRequests',
          message: 'Terlalu banyak permintaan. Silakan coba lagi sebentar lagi.',
          retryAfterSeconds: retryAfter > 0 ? retryAfter : options.windowSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  /**
   * Kunci gabungan akun + IP. Untuk endpoint anonim seperti login, identitas
   * diambil dari body (email) dan di-hash agar tidak tersimpan sebagai teks
   * terbaca pada Redis.
   */
  private subjectFor(request: AuthenticatedRequest, options: RateLimitOptions): string {
    const ip = request.ip ?? 'unknown';

    if (request.user) return `u:${request.user.id}:${ip}`;

    if (options.keyFromBody) {
      const body = request.body as Record<string, unknown> | undefined;
      const value = body?.[options.keyFromBody];
      if (typeof value === 'string' && value.length > 0) {
        return `a:${sha256Hex(value.toLowerCase()).slice(0, 32)}:${ip}`;
      }
    }

    return `ip:${ip}`;
  }
}
