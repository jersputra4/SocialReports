import { Inject, Injectable } from '@nestjs/common';
import { Response } from 'express';
import { AppConfig, CONFIG_TOKEN } from '../config/configuration';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { randomToken, sha256Hex } from '../utils/crypto.util';
import { AuthenticatedUser } from './auth.types';

interface CachedSession {
  sessionId: string;
  userId: string;
  email: string;
  fullName: string;
  roleId: string;
  roleCode: string;
  isStaff: boolean;
  permissions: string[];
  mfaVerifiedAt: string | null;
  mustChangePassword: boolean;
  csrfToken: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
}

/**
 * Sesi server-side opaque — keputusan BRD 4.3.
 *
 * Token di cookie hanyalah nilai acak; seluruh keadaan sesi ada di tabel
 * `user_sessions`. Konsekuensinya sesi dapat dicabut seketika, yang tidak
 * mungkin dilakukan pada JWT tanpa daftar cabut terpisah.
 *
 * Redis hanya cache pembacaan. Bila Redis kosong, sesi dibaca dari database.
 */
@Injectable()
export class SessionService {
  /** Tulis balik `last_seen_at` paling sering satu kali per interval ini. */
  private static readonly TOUCH_INTERVAL_SECONDS = 60;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
  ) {}

  private cacheKey(tokenHash: string): string {
    return `sess:${tokenHash}`;
  }

  private limits(isStaff: boolean): { idleMinutes: number; absoluteHours: number } {
    return isStaff
      ? {
          idleMinutes: this.config.session.idleMinutesAdmin,
          absoluteHours: this.config.session.absoluteHoursAdmin,
        }
      : {
          idleMinutes: this.config.session.idleMinutesUser,
          absoluteHours: this.config.session.absoluteHoursUser,
        };
  }

  async create(params: {
    userId: string;
    isStaff: boolean;
    mfaVerified: boolean;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<{ token: string; csrfToken: string; sessionId: string; expiresAt: Date }> {
    const token = randomToken(32);
    const tokenHash = sha256Hex(token);
    const csrfToken = randomToken(24);

    const { idleMinutes, absoluteHours } = this.limits(params.isStaff);
    const now = Date.now();
    const idleExpiresAt = new Date(now + idleMinutes * 60_000);
    const absoluteExpiresAt = new Date(now + absoluteHours * 3_600_000);

    const session = await this.prisma.userSession.create({
      data: {
        userId: params.userId,
        tokenHash,
        csrfToken,
        ipAddress: params.ipAddress?.slice(0, 64),
        userAgent: params.userAgent?.slice(0, 512),
        mfaVerifiedAt: params.mfaVerified ? new Date() : null,
        idleExpiresAt,
        absoluteExpiresAt,
      },
    });

    return { token, csrfToken, sessionId: session.id, expiresAt: absoluteExpiresAt };
  }

  /**
   * Memvalidasi token sesi dan mengembalikan identitas pemanggil.
   * Mengembalikan null bila sesi tidak ada, dicabut, atau kedaluwarsa.
   */
  async resolve(token: string): Promise<AuthenticatedUser | null> {
    const tokenHash = sha256Hex(token);
    const cached = await this.readCache(tokenHash);
    const session = cached ?? (await this.readDatabase(tokenHash));
    if (!session) return null;

    const now = Date.now();
    if (new Date(session.idleExpiresAt).getTime() <= now) {
      await this.revokeByTokenHash(tokenHash, 'idle timeout');
      return null;
    }
    if (new Date(session.absoluteExpiresAt).getTime() <= now) {
      await this.revokeByTokenHash(tokenHash, 'absolute timeout');
      return null;
    }

    await this.slideIdleWindow(session, tokenHash, now);

    return {
      id: session.userId,
      email: session.email,
      fullName: session.fullName,
      roleId: session.roleId,
      roleCode: session.roleCode,
      isStaff: session.isStaff,
      permissions: session.permissions,
      sessionId: session.sessionId,
      mfaVerifiedAt: session.mfaVerifiedAt ? new Date(session.mfaVerifiedAt) : null,
      mustChangePassword: session.mustChangePassword,
    };
  }

  /** Token CSRF milik sesi, dipakai CsrfGuard. */
  async csrfTokenFor(token: string): Promise<string | null> {
    const tokenHash = sha256Hex(token);
    const session = (await this.readCache(tokenHash)) ?? (await this.readDatabase(tokenHash));
    return session?.csrfToken ?? null;
  }

  private async readCache(tokenHash: string): Promise<CachedSession | null> {
    const raw = await this.redis.get(this.cacheKey(tokenHash));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as CachedSession;
    } catch {
      return null;
    }
  }

  private async readDatabase(tokenHash: string): Promise<CachedSession | null> {
    const session = await this.prisma.userSession.findUnique({
      where: { tokenHash },
      include: {
        user: {
          include: {
            role: { include: { permissions: { include: { permission: true } } } },
          },
        },
      },
    });

    if (!session || session.revokedAt) return null;
    if (session.user.status !== 'ACTIVE') return null;

    const cached: CachedSession = {
      sessionId: session.id,
      userId: session.userId,
      email: session.user.email,
      fullName: session.user.fullName,
      roleId: session.user.roleId,
      roleCode: session.user.role.code,
      isStaff: session.user.role.isStaff,
      permissions: session.user.role.permissions.map((rp) => rp.permission.code),
      mfaVerifiedAt: session.mfaVerifiedAt?.toISOString() ?? null,
      mustChangePassword: session.user.mustChangePassword,
      csrfToken: session.csrfToken,
      idleExpiresAt: session.idleExpiresAt.toISOString(),
      absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
    };

    await this.writeCache(tokenHash, cached);
    return cached;
  }

  private async writeCache(tokenHash: string, session: CachedSession): Promise<void> {
    const ttlSeconds = Math.max(
      1,
      Math.floor((new Date(session.idleExpiresAt).getTime() - Date.now()) / 1000),
    );
    await this.redis.setEx(this.cacheKey(tokenHash), JSON.stringify(session), ttlSeconds);
  }

  /**
   * Menggeser batas idle. Penulisan ke database dibatasi satu kali per menit
   * agar permintaan baca yang ramai tidak berubah menjadi beban tulis.
   */
  private async slideIdleWindow(
    session: CachedSession,
    tokenHash: string,
    now: number,
  ): Promise<void> {
    const { idleMinutes } = this.limits(session.isStaff);
    const nextIdle = new Date(Math.min(now + idleMinutes * 60_000,
      new Date(session.absoluteExpiresAt).getTime()));

    const remaining = new Date(session.idleExpiresAt).getTime() - now;
    const shouldPersist =
      remaining < (idleMinutes * 60_000) - SessionService.TOUCH_INTERVAL_SECONDS * 1000;

    session.idleExpiresAt = nextIdle.toISOString();
    await this.writeCache(tokenHash, session);

    if (shouldPersist) {
      await this.prisma.userSession
        .update({
          where: { id: session.sessionId },
          data: { idleExpiresAt: nextIdle, lastSeenAt: new Date(now) },
        })
        .catch(() => undefined);
    }
  }

  /** Menandai OTP baru saja diverifikasi — memulai jendela step-up. */
  async markMfaVerified(sessionId: string): Promise<void> {
    const session = await this.prisma.userSession.update({
      where: { id: sessionId },
      data: { mfaVerifiedAt: new Date() },
      select: { tokenHash: true },
    });
    await this.redis.del(this.cacheKey(session.tokenHash));
  }

  async revoke(sessionId: string, reason: string): Promise<void> {
    const session = await this.prisma.userSession
      .update({
        where: { id: sessionId },
        data: { revokedAt: new Date(), revokedReason: reason.slice(0, 128) },
        select: { tokenHash: true },
      })
      .catch(() => null);
    if (session) await this.redis.del(this.cacheKey(session.tokenHash));
  }

  private async revokeByTokenHash(tokenHash: string, reason: string): Promise<void> {
    await this.prisma.userSession
      .updateMany({
        where: { tokenHash, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: reason },
      })
      .catch(() => undefined);
    await this.redis.del(this.cacheKey(tokenHash));
  }

  /** Mencabut seluruh sesi milik satu user — dipakai setelah reset password. */
  async revokeAllForUser(userId: string, reason: string): Promise<number> {
    const sessions = await this.prisma.userSession.findMany({
      where: { userId, revokedAt: null },
      select: { tokenHash: true },
    });

    const { count } = await this.prisma.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason.slice(0, 128) },
    });

    await this.redis.del(...sessions.map((s) => this.cacheKey(s.tokenHash)));
    return count;
  }

  attachCookies(response: Response, token: string, csrfToken: string, expiresAt: Date): void {
    const { cookieName, csrfCookieName, cookieSecure, cookieDomain } = this.config.session;

    response.cookie(cookieName, token, {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: 'lax',
      domain: cookieDomain,
      path: '/',
      expires: expiresAt,
    });

    // Dibaca JavaScript lalu dikirim kembali sebagai header X-CSRF-Token
    // (pola double submit). Karena itu cookie ini sengaja tidak HttpOnly.
    response.cookie(csrfCookieName, csrfToken, {
      httpOnly: false,
      secure: cookieSecure,
      sameSite: 'lax',
      domain: cookieDomain,
      path: '/',
      expires: expiresAt,
    });
  }

  clearCookies(response: Response): void {
    const { cookieName, csrfCookieName, cookieDomain } = this.config.session;
    const options = { domain: cookieDomain, path: '/' };
    response.clearCookie(cookieName, options);
    response.clearCookie(csrfCookieName, options);
  }
}
