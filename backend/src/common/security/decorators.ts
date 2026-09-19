import { ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import { AuthenticatedRequest, AuthenticatedUser } from './auth.types';

export const IS_PUBLIC_KEY = 'auth:public';
export const PERMISSIONS_KEY = 'auth:permissions';
export const STEP_UP_KEY = 'auth:step-up';
export const RATE_LIMIT_KEY = 'auth:rate-limit';
export const SKIP_CSRF_KEY = 'auth:skip-csrf';

/** Endpoint tanpa sesi (registrasi, login, webhook, health). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Endpoint yang menuntut izin tertentu (kode pada tabel permissions). */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/**
 * Aksi sensitif yang menuntut OTP ulang dalam 10 menit terakhir (BRD 4.3):
 * ubah harga/PPN, ubah role/izin, void bukti pengerjaan, ubah master
 * hukum/policy.
 */
export const RequireStepUpMfa = () => SetMetadata(STEP_UP_KEY, true);

export interface RateLimitOptions {
  /** Nama jendela, dipakai sebagai bagian kunci Redis. */
  name: string;
  limit: number;
  windowSeconds: number;
  /** Kunci tambahan dari body, mis. 'email' agar batas dihitung per akun. */
  keyFromBody?: string;
}

export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);

/** Webhook gateway pembayaran memakai tanda tangan HMAC, bukan token CSRF. */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF_KEY, true);

export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    if (!user) return undefined;
    return data ? user[data] : user;
  },
);
