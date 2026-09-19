import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { AppConfig, CONFIG_TOKEN } from '../common/config/configuration';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AuditAction } from '../common/audit/audit-actions';
import { MailerService } from '../mailer/mailer.service';
import { MailTemplates } from '../mailer/mail-templates';
import { generateOtp, randomToken, safeEqual, sha256Hex } from '../common/utils/crypto.util';

export type MfaPurpose = 'LOGIN' | 'STEP_UP';

export interface MfaChallengeIssued {
  challengeId: string;
  /** Nilai rahasia yang dipasang sebagai cookie; mengikat OTP ke peramban ini. */
  binding: string;
  expiresAt: Date;
}

/**
 * MFA lewat email terdaftar — BRD/SRS v1.1 §4.3.
 *
 * Catatan dokumen yang tetap berlaku: MFA email lebih lemah daripada
 * TOTP/WebAuthn karena keamanannya mengikuti keamanan mailbox. Email admin
 * karena itu wajib memakai domain perusahaan dengan MFA sendiri, dan TOTP
 * dicatat sebagai peningkatan berikutnya.
 *
 * Yang dijaga di sini:
 *   - OTP 6 digit dari CSPRNG, disimpan sebagai hash, sekali pakai
 *   - berlaku 5 menit, maksimal 5 percobaan salah per challenge
 *   - jeda kirim ulang 60 detik, maksimal 3 permintaan per 10 menit
 *   - terikat pada satu challenge dan satu peramban (cookie binding)
 */
@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    private readonly audit: AuditService,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
  ) {}

  private get ttlMs(): number {
    return this.config.security.otpTtlMinutes * 60_000;
  }

  async issue(params: {
    userId: string;
    email: string;
    purpose: MfaPurpose;
    ipAddress?: string;
  }): Promise<MfaChallengeIssued> {
    await this.assertRequestBudget(params.userId);

    const otp = generateOtp();
    const binding = randomToken(24);
    const expiresAt = new Date(Date.now() + this.ttlMs);

    const challenge = await this.prisma.mfaChallenge.create({
      data: {
        userId: params.userId,
        otpHash: sha256Hex(otp),
        purpose: params.purpose,
        expiresAt,
        sessionBinding: sha256Hex(binding),
        ipAddress: params.ipAddress?.slice(0, 64),
      },
    });

    const content =
      params.purpose === 'LOGIN'
        ? MailTemplates.loginOtp(this.config.appName, otp, this.config.security.otpTtlMinutes)
        : MailTemplates.stepUpOtp(this.config.appName, otp, this.config.security.otpTtlMinutes);

    await this.mailer.send(params.email, content);

    await this.audit.record({
      action: AuditAction.MFA_CHALLENGE_SENT,
      entityType: 'mfa_challenge',
      entityId: challenge.id,
      actorId: params.userId,
      after: { purpose: params.purpose },
    });

    return { challengeId: challenge.id, binding, expiresAt };
  }

  /**
   * Jeda kirim ulang dan kuota per 10 menit (BRD 4.3).
   * Dihitung dari tabel challenge, bukan dari penghitung di Redis, agar batas
   * tetap berlaku ketika cache hilang.
   */
  private async assertRequestBudget(userId: string): Promise<void> {
    const now = Date.now();

    const last = await this.prisma.mfaChallenge.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });

    if (last) {
      const elapsed = (now - last.createdAt.getTime()) / 1000;
      const cooldown = this.config.security.otpResendCooldownSeconds;
      if (elapsed < cooldown) {
        throw new BadRequestException(
          `Mohon tunggu ${Math.ceil(cooldown - elapsed)} detik sebelum meminta kode baru.`,
        );
      }
    }

    const recent = await this.prisma.mfaChallenge.count({
      where: { userId, createdAt: { gte: new Date(now - 10 * 60_000) } },
    });

    if (recent >= this.config.security.otpMaxPer10Minutes) {
      throw new BadRequestException(
        'Terlalu banyak permintaan kode. Silakan coba lagi dalam beberapa menit.',
      );
    }
  }

  /**
   * Memverifikasi OTP. Mengembalikan userId bila benar.
   * Challenge gugur setelah berhasil, setelah kedaluwarsa, atau setelah
   * mencapai batas percobaan salah.
   */
  async verify(params: {
    challengeId: string;
    otp: string;
    binding?: string;
    purpose: MfaPurpose;
  }): Promise<{ userId: string }> {
    const challenge = await this.prisma.mfaChallenge.findUnique({
      where: { id: params.challengeId },
    });

    const fail = async (reason: string): Promise<never> => {
      if (challenge) {
        await this.audit.record({
          action: AuditAction.MFA_FAILED,
          entityType: 'mfa_challenge',
          entityId: challenge.id,
          actorId: challenge.userId,
          after: { reason },
        });
      }
      throw new UnauthorizedException('Kode verifikasi tidak valid atau sudah kedaluwarsa.');
    };

    if (!challenge) return fail('challenge tidak ditemukan');
    if (challenge.purpose !== params.purpose) return fail('tujuan challenge tidak cocok');
    if (challenge.usedAt) return fail('challenge sudah dipakai');
    if (challenge.expiresAt.getTime() <= Date.now()) return fail('challenge kedaluwarsa');
    if (challenge.attempts >= this.config.security.otpMaxAttempts) {
      return fail('batas percobaan tercapai');
    }
    if (!params.binding || !safeEqual(challenge.sessionBinding, sha256Hex(params.binding))) {
      return fail('challenge tidak terikat pada peramban ini');
    }

    if (!safeEqual(challenge.otpHash, sha256Hex(params.otp))) {
      const updated = await this.prisma.mfaChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
        select: { attempts: true },
      });
      return fail(`kode salah (percobaan ke-${updated.attempts})`);
    }

    await this.prisma.mfaChallenge.update({
      where: { id: challenge.id },
      data: { usedAt: new Date() },
    });

    await this.audit.record({
      action: AuditAction.MFA_SUCCESS,
      entityType: 'mfa_challenge',
      entityId: challenge.id,
      actorId: challenge.userId,
      after: { purpose: params.purpose },
    });

    return { userId: challenge.userId };
  }

  /** Dipakai kirim ulang: mengambil pemilik challenge tanpa membocorkan OTP. */
  async ownerOf(challengeId: string): Promise<{ userId: string; email: string } | null> {
    const challenge = await this.prisma.mfaChallenge.findUnique({
      where: { id: challengeId },
      include: { user: { select: { email: true } } },
    });
    if (!challenge) return null;
    return { userId: challenge.userId, email: challenge.user.email };
  }
}
