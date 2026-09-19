import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { AppConfig, CONFIG_TOKEN } from '../common/config/configuration';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AuditAction } from '../common/audit/audit-actions';
import { SessionService } from '../common/security/session.service';
import { MailerService } from '../mailer/mailer.service';
import { MailTemplates } from '../mailer/mail-templates';
import { randomToken, sha256Hex } from '../common/utils/crypto.util';
import { PasswordPolicy } from './password.policy';
import { MfaService } from './mfa.service';

/**
 * HTTP 423 Locked (RFC 4918). Enum HttpStatus milik NestJS tidak memuat
 * nilai ini, jadi didefinisikan di sini.
 */
const HTTP_LOCKED = 423;

export interface LoginContext {
  ipAddress?: string;
  userAgent?: string;
}

export type LoginResult =
  | { kind: 'MFA_REQUIRED'; challengeId: string; binding: string; expiresAt: Date }
  | {
      kind: 'SESSION';
      token: string;
      csrfToken: string;
      expiresAt: Date;
      mustChangePassword: boolean;
    };

/** Nama role bawaan. Seed membuat keempat role ini. */
export const ROLE_USER = 'user';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly passwordPolicy: PasswordPolicy;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly mfa: MfaService,
    private readonly mailer: MailerService,
    private readonly audit: AuditService,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
  ) {
    this.passwordPolicy = new PasswordPolicy({
      minLengthUser: config.security.passwordMinUser,
      minLengthAdmin: config.security.passwordMinAdmin,
    });
  }

  private hashPassword(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: this.config.security.argon2MemoryKiB,
      timeCost: this.config.security.argon2TimeCost,
      parallelism: this.config.security.argon2Parallelism,
    });
  }

  private async assertPasswordAcceptable(
    password: string,
    isStaff: boolean,
    context: { email?: string; fullName?: string },
  ): Promise<void> {
    const result = await this.passwordPolicy.check(password, isStaff, context);
    if (!result.valid) {
      throw new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'WeakPassword',
        message: result.errors,
      });
    }
  }

  // ------------------------------------------------------------- registrasi --

  /**
   * Pendaftaran akun user.
   *
   * Respons selalu sama, baik email sudah terdaftar maupun belum, sehingga
   * halaman pendaftaran tidak dapat dipakai untuk memetakan daftar pengguna.
   */
  async register(input: {
    email: string;
    fullName: string;
    password: string;
    phone?: string;
  }): Promise<void> {
    await this.assertPasswordAcceptable(input.password, false, {
      email: input.email,
      fullName: input.fullName,
    });

    const existing = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true, status: true },
    });

    if (existing) {
      this.logger.warn('Pendaftaran untuk email yang sudah ada — respons dibuat seragam');
      return;
    }

    const role = await this.prisma.role.findUnique({ where: { code: ROLE_USER } });
    if (!role) throw new Error('Role bawaan "user" belum tersedia. Jalankan seed.');

    const user = await this.prisma.user.create({
      data: {
        email: input.email,
        fullName: input.fullName.trim(),
        phone: input.phone,
        passwordHash: await this.hashPassword(input.password),
        roleId: role.id,
        status: 'PENDING_VERIFICATION',
      },
    });

    await this.audit.record({
      action: AuditAction.USER_UPDATE,
      entityType: 'user',
      entityId: user.id,
      actorId: user.id,
      after: { event: 'REGISTERED', status: 'PENDING_VERIFICATION' },
    });

    await this.sendEmailVerification(user.id, user.email);
  }

  async sendEmailVerification(userId: string, email: string): Promise<void> {
    const token = randomToken(32);
    const ttlHours = this.config.security.emailVerificationTtlHours;

    await this.prisma.emailVerification.create({
      data: {
        userId,
        tokenHash: sha256Hex(token),
        expiresAt: new Date(Date.now() + ttlHours * 3_600_000),
      },
    });

    const link = `${this.config.publicUrl}/verifikasi-email?token=${token}`;
    await this.mailer.send(email, MailTemplates.emailVerification(this.config.appName, link, ttlHours));
  }

  async verifyEmail(token: string): Promise<void> {
    const record = await this.prisma.emailVerification.findUnique({
      where: { tokenHash: sha256Hex(token) },
      include: { user: true },
    });

    if (!record || record.usedAt || record.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('Tautan verifikasi tidak valid atau sudah kedaluwarsa.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.emailVerification.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      });
      await tx.user.update({
        where: { id: record.userId },
        data: {
          emailVerifiedAt: new Date(),
          status: record.user.status === 'PENDING_VERIFICATION' ? 'ACTIVE' : record.user.status,
        },
      });
      await this.audit.record(
        {
          action: AuditAction.EMAIL_VERIFIED,
          entityType: 'user',
          entityId: record.userId,
          actorId: record.userId,
        },
        tx,
      );
    });
  }

  // ------------------------------------------------------------------ login --

  async login(email: string, password: string, context: LoginContext): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { role: true },
    });

    // Tetap jalankan verifikasi argon2 terhadap hash palsu agar waktu respons
    // untuk email yang tidak ada mirip dengan email yang ada.
    if (!user) {
      await argon2
        .verify(
          '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$0000000000000000000000000000000000000000000',
          password,
        )
        .catch(() => false);
      await this.audit.record({
        action: AuditAction.LOGIN_FAILED,
        entityType: 'user',
        entityId: 'unknown',
        after: { reason: 'email tidak terdaftar' },
      });
      throw new UnauthorizedException('Email atau kata sandi salah.');
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const passwordOk = await argon2.verify(user.passwordHash, password).catch(() => false);
      await this.audit.record({
        action: AuditAction.LOGIN_FAILED,
        entityType: 'user',
        entityId: user.id,
        actorId: user.id,
        after: { reason: 'akun terkunci', lockedUntil: user.lockedUntil.toISOString() },
      });

      if (passwordOk) {
        // Kredensial benar: menyebut status kunci tidak menambah kebocoran.
        const lockedBody = {
          statusCode: HTTP_LOCKED,
          error: 'AccountLocked',
          message: 'Akun terkunci sementara karena terlalu banyak percobaan gagal.',
          lockedUntil: user.lockedUntil.toISOString(),
        };
        throw new HttpException(lockedBody, HTTP_LOCKED);
      }
      throw new UnauthorizedException('Email atau kata sandi salah.');
    }

    const passwordOk = await argon2.verify(user.passwordHash, password).catch(() => false);
    if (!passwordOk) {
      await this.registerFailedLogin(user.id, user.failedLoginCount, user.lockoutLevel);
      throw new UnauthorizedException('Email atau kata sandi salah.');
    }

    if (user.status === 'SUSPENDED') {
      throw new ForbiddenException('Akun Anda dinonaktifkan. Hubungi administrator.');
    }
    if (!user.emailVerifiedAt) {
      const unverifiedBody = {
        statusCode: HttpStatus.FORBIDDEN,
        error: 'EmailNotVerified',
        message: 'Email Anda belum diverifikasi. Periksa kotak masuk Anda.',
      };
      throw new HttpException(unverifiedBody, HttpStatus.FORBIDDEN);
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockoutLevel: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    // MFA wajib untuk seluruh role internal di semua environment (BRD 4.3).
    const mfaRequired = user.role.isStaff || user.mfaEnabled;

    if (mfaRequired) {
      const challenge = await this.mfa.issue({
        userId: user.id,
        email: user.email,
        purpose: 'LOGIN',
        ipAddress: context.ipAddress,
      });
      return { kind: 'MFA_REQUIRED', ...challenge };
    }

    const session = await this.sessions.create({
      userId: user.id,
      isStaff: user.role.isStaff,
      mfaVerified: false,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    await this.audit.record({
      action: AuditAction.LOGIN,
      entityType: 'user',
      entityId: user.id,
      actorId: user.id,
      actorRole: user.role.code,
      after: { mfa: false },
    });

    return {
      kind: 'SESSION',
      token: session.token,
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
      mustChangePassword: user.mustChangePassword,
    };
  }

  /**
   * Lockout bertingkat (BRD 4.3): 5 kegagalan berturut-turut mengunci akun
   * 15 menit; setiap pengulangan menggandakan durasinya hingga batas 24 jam.
   */
  private async registerFailedLogin(
    userId: string,
    currentCount: number,
    currentLevel: number,
  ): Promise<void> {
    const nextCount = currentCount + 1;
    const threshold = this.config.security.lockoutThreshold;

    if (nextCount < threshold) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { failedLoginCount: nextCount },
      });
      await this.audit.record({
        action: AuditAction.LOGIN_FAILED,
        entityType: 'user',
        entityId: userId,
        actorId: userId,
        after: { failedLoginCount: nextCount },
      });
      return;
    }

    const level = currentLevel + 1;
    const minutes = Math.min(
      this.config.security.lockoutBaseMinutes * 2 ** (level - 1),
      24 * 60,
    );
    const lockedUntil = new Date(Date.now() + minutes * 60_000);

    await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginCount: 0, lockoutLevel: level, lockedUntil },
    });

    await this.audit.record({
      action: AuditAction.ACCOUNT_LOCKED,
      entityType: 'user',
      entityId: userId,
      actorId: userId,
      after: { lockoutLevel: level, minutes, lockedUntil: lockedUntil.toISOString() },
    });
  }

  // -------------------------------------------------------------------- MFA --

  async completeMfaLogin(params: {
    challengeId: string;
    otp: string;
    binding?: string;
    context: LoginContext;
  }): Promise<{ token: string; csrfToken: string; expiresAt: Date; mustChangePassword: boolean }> {
    const { userId } = await this.mfa.verify({
      challengeId: params.challengeId,
      otp: params.otp,
      binding: params.binding,
      purpose: 'LOGIN',
    });

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { role: true },
    });

    if (user.status === 'SUSPENDED') {
      throw new ForbiddenException('Akun Anda dinonaktifkan. Hubungi administrator.');
    }

    const session = await this.sessions.create({
      userId: user.id,
      isStaff: user.role.isStaff,
      mfaVerified: true,
      ipAddress: params.context.ipAddress,
      userAgent: params.context.userAgent,
    });

    await this.audit.record({
      action: AuditAction.LOGIN,
      entityType: 'user',
      entityId: user.id,
      actorId: user.id,
      actorRole: user.role.code,
      after: { mfa: true },
    });

    return {
      token: session.token,
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
      mustChangePassword: user.mustChangePassword,
    };
  }

  async resendMfa(challengeId: string, ipAddress?: string) {
    const owner = await this.mfa.ownerOf(challengeId);
    if (!owner) throw new BadRequestException('Permintaan kode tidak dikenali.');
    return this.mfa.issue({
      userId: owner.userId,
      email: owner.email,
      purpose: 'LOGIN',
      ipAddress,
    });
  }

  async requestStepUp(userId: string, ipAddress?: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true },
    });
    return this.mfa.issue({ userId, email: user.email, purpose: 'STEP_UP', ipAddress });
  }

  async verifyStepUp(params: {
    userId: string;
    sessionId: string;
    challengeId: string;
    otp: string;
    binding?: string;
  }): Promise<void> {
    const { userId } = await this.mfa.verify({
      challengeId: params.challengeId,
      otp: params.otp,
      binding: params.binding,
      purpose: 'STEP_UP',
    });

    if (userId !== params.userId) {
      throw new UnauthorizedException('Kode verifikasi tidak valid.');
    }

    await this.sessions.markMfaVerified(params.sessionId);
  }

  async setMfaEnabled(userId: string, enabled: boolean): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { role: true },
    });

    if (user.role.isStaff && !enabled) {
      throw new ForbiddenException('MFA wajib aktif untuk akun internal.');
    }
    if (!user.emailVerifiedAt) {
      throw new BadRequestException('Verifikasi email Anda terlebih dahulu.');
    }

    await this.prisma.user.update({ where: { id: userId }, data: { mfaEnabled: enabled } });
    await this.audit.record({
      action: AuditAction.USER_UPDATE,
      entityType: 'user',
      entityId: userId,
      actorId: userId,
      before: { mfaEnabled: user.mfaEnabled },
      after: { mfaEnabled: enabled },
    });
  }

  // -------------------------------------------------------- reset & ganti --

  /**
   * Permintaan reset kata sandi.
   * Respons seragam agar keberadaan akun tidak dapat ditebak (BRD 4.3).
   */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return;

    const token = randomToken(32);
    const ttlMinutes = this.config.security.passwordResetTtlMinutes;

    await this.prisma.passwordReset.create({
      data: {
        userId: user.id,
        tokenHash: sha256Hex(token),
        expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
      },
    });

    await this.audit.record({
      action: AuditAction.PASSWORD_RESET_REQUEST,
      entityType: 'user',
      entityId: user.id,
      actorId: user.id,
    });

    const link = `${this.config.publicUrl}/atur-ulang-kata-sandi?token=${token}`;
    await this.mailer.send(
      user.email,
      MailTemplates.passwordReset(this.config.appName, link, ttlMinutes),
    );
  }

  async confirmPasswordReset(token: string, newPassword: string): Promise<void> {
    const record = await this.prisma.passwordReset.findUnique({
      where: { tokenHash: sha256Hex(token) },
      include: { user: { include: { role: true } } },
    });

    if (!record || record.usedAt || record.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('Tautan atur ulang tidak valid atau sudah kedaluwarsa.');
    }

    await this.assertPasswordAcceptable(newPassword, record.user.role.isStaff, {
      email: record.user.email,
      fullName: record.user.fullName,
    });

    const passwordHash = await this.hashPassword(newPassword);

    await this.prisma.$transaction(async (tx) => {
      await tx.passwordReset.update({ where: { id: record.id }, data: { usedAt: new Date() } });
      await tx.user.update({
        where: { id: record.userId },
        data: {
          passwordHash,
          passwordChangedAt: new Date(),
          mustChangePassword: false,
          failedLoginCount: 0,
          lockoutLevel: 0,
          lockedUntil: null,
        },
      });
      await this.audit.record(
        {
          action: AuditAction.PASSWORD_CHANGED,
          entityType: 'user',
          entityId: record.userId,
          actorId: record.userId,
          after: { via: 'reset' },
        },
        tx,
      );
    });

    // Seluruh sesi dicabut setelah reset (BRD 4.3).
    await this.sessions.revokeAllForUser(record.userId, 'password reset');
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    keepSessionId?: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { role: true },
    });

    const ok = await argon2.verify(user.passwordHash, currentPassword).catch(() => false);
    if (!ok) throw new UnauthorizedException('Kata sandi saat ini salah.');

    if (currentPassword === newPassword) {
      throw new BadRequestException('Kata sandi baru harus berbeda dari kata sandi lama.');
    }

    await this.assertPasswordAcceptable(newPassword, user.role.isStaff, {
      email: user.email,
      fullName: user.fullName,
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await this.hashPassword(newPassword),
        passwordChangedAt: new Date(),
        mustChangePassword: false,
      },
    });

    await this.audit.record({
      action: AuditAction.PASSWORD_CHANGED,
      entityType: 'user',
      entityId: userId,
      actorId: userId,
      after: { via: 'setting' },
    });

    await this.sessions.revokeAllForUser(userId, 'password changed');
    // Sesi yang sedang dipakai dibiarkan hidup bila diminta, agar pengguna
    // tidak terlempar keluar setelah mengganti kata sandinya sendiri.
    if (keepSessionId) {
      await this.prisma.userSession
        .update({
          where: { id: keepSessionId },
          data: { revokedAt: null, revokedReason: null },
        })
        .catch(() => undefined);
    }
  }

  async logout(sessionId: string, userId: string): Promise<void> {
    await this.sessions.revoke(sessionId, 'logout');
    await this.audit.record({
      action: AuditAction.LOGOUT,
      entityType: 'user',
      entityId: userId,
      actorId: userId,
    });
  }
}
