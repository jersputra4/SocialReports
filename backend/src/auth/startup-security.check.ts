import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AppConfig, CONFIG_TOKEN } from '../common/config/configuration';
import { PrismaService } from '../common/prisma/prisma.service';

/**
 * Pemeriksaan keamanan saat aplikasi start — BRD/SRS v1.1 §4.1, AC-05.
 *
 * Di production aplikasi GAGAL START bila:
 *   - ada akun internal yang kata sandinya ada pada daftar umum/bawaan, atau
 *   - ada secret yang masih memakai nilai contoh dari .env.example.
 *
 * Kegagalan start dipilih daripada peringatan di log karena peringatan
 * terlewat, sedangkan proses yang tidak mau hidup pasti ditindaklanjuti.
 *
 * Di lingkungan pengembangan hasilnya hanya peringatan agar tidak menghalangi
 * pekerjaan sehari-hari.
 */
@Injectable()
export class StartupSecurityCheck implements OnApplicationBootstrap {
  private readonly logger = new Logger(StartupSecurityCheck.name);

  /**
   * Daftar pendek yang paling sering dipakai pada akun bawaan.
   * Sengaja dibatasi: setiap kandidat berarti satu verifikasi argon2 per akun
   * internal, dan verifikasi argon2id memang mahal secara sengaja.
   */
  private static readonly DEFAULT_PASSWORDS = [
    'admin', 'admin123', 'admin1234', 'administrator', 'password', 'password1',
    'password123', 'Password123', 'Password123!', 'changeme', 'changeme123',
    'Changeme123!', '12345678', '123456789', 'qwerty123', 'letmein', 'root',
    'toor', 'default', 'default123', 'demo1234', 'prototype123', 'secret',
    'welcome1', 'welcome123', 'P@ssw0rd', 'p@ssword123', 'rahasia123',
    'admin@123', 'adminadmin',
  ];

  /** Penanda nilai contoh pada .env.example. */
  private static readonly PLACEHOLDER_MARKERS = ['dev_only', 'change_me', 'changeme'];

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const problems: string[] = [];

    problems.push(...this.checkSecrets());
    problems.push(...(await this.checkDefaultPasswords()));

    if (problems.length === 0) {
      this.logger.log('Pemeriksaan keamanan awal lulus.');
      return;
    }

    const summary = problems.map((p) => `  - ${p}`).join('\n');

    if (this.config.isProduction) {
      this.logger.error(`Pemeriksaan keamanan awal GAGAL:\n${summary}`);
      throw new Error(
        'Aplikasi dihentikan karena pemeriksaan keamanan awal gagal. Perbaiki temuan di atas lalu jalankan ulang.',
      );
    }

    this.logger.warn(
      `Pemeriksaan keamanan awal menemukan masalah (diabaikan di luar production):\n${summary}`,
    );
  }

  private checkSecrets(): string[] {
    const problems: string[] = [];
    const secrets: Array<[string, string]> = [
      ['SESSION_SECRET', this.config.session.secret],
      ['PAYMENT_WEBHOOK_SECRET', this.config.payment.webhookSecret],
      ['N8N_HMAC_SECRET', this.config.notification.n8nHmacSecret],
      ['FETCHER_SERVICE_TOKEN', this.config.fetcher.serviceToken],
      ['S3_SECRET_KEY', this.config.storage.secretKey],
    ];

    for (const [name, value] of secrets) {
      const lowered = value.toLowerCase();
      if (StartupSecurityCheck.PLACEHOLDER_MARKERS.some((marker) => lowered.includes(marker))) {
        problems.push(`${name} masih memakai nilai contoh dari .env.example.`);
      }
      if (value.length < 32) {
        problems.push(`${name} terlalu pendek (minimal 32 karakter).`);
      }
    }

    if (this.config.isProduction && !this.config.session.cookieSecure) {
      problems.push('COOKIE_SECURE harus true di production.');
    }

    return problems;
  }

  private async checkDefaultPasswords(): Promise<string[]> {
    const staff = await this.prisma.user.findMany({
      where: { role: { isStaff: true }, status: { not: 'SUSPENDED' } },
      select: { id: true, email: true, passwordHash: true },
    });

    const problems: string[] = [];

    for (const account of staff) {
      for (const candidate of StartupSecurityCheck.DEFAULT_PASSWORDS) {
        const matches = await argon2.verify(account.passwordHash, candidate).catch(() => false);
        if (matches) {
          problems.push(
            `Akun internal ${account.email} memakai kata sandi bawaan/umum. Ganti sebelum menjalankan sistem.`,
          );
          break;
        }
      }
    }

    return problems;
  }
}
