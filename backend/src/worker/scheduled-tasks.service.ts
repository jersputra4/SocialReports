import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { PaymentsService } from '../payments/payments.service';
import { OutboxDispatcherService } from './outbox-dispatcher.service';

/**
 * Pekerjaan terjadwal worker.
 *
 * Seluruh pekerjaan di sini aman dijalankan berulang (idempoten) dan aman bila
 * terlewat satu putaran: masing-masing membaca keadaan terkini dari database,
 * bukan dari memori atau dari antrean.
 */
@Injectable()
export class ScheduledTasksService {
  private readonly logger = new Logger(ScheduledTasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly payments: PaymentsService,
    private readonly dispatcher: OutboxDispatcherService,
  ) {}

  /**
   * Pemindai outbox.
   *
   * Pekerjaan biasanya sudah dikirim lewat antrean BullMQ; pemindai ini jaring
   * pengamannya — event yang antreannya hilang (Redis restart) tetap terkirim
   * karena tabel outbox adalah sumber kebenarannya.
   */
  @Cron(CronExpression.EVERY_30_SECONDS, { name: 'outbox-scan' })
  async dispatchOutbox(): Promise<void> {
    const result = await this.dispatcher.dispatchDue(25);
    if (result.sent > 0 || result.failed > 0) {
      this.logger.log(`Outbox: ${result.sent} terkirim, ${result.failed} gagal.`);
    }
  }

  /** Menutup order pembayaran yang lewat batas waktu (AC-16). */
  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'payment-expiry' })
  async expirePayments(): Promise<void> {
    const expired = await this.payments.expireOverduePayments();
    if (expired > 0) this.logger.log(`${expired} order pembayaran ditutup karena kedaluwarsa.`);
  }

  /** Membatalkan report yang tidak dibayar ulang dalam 7 hari (baris 11). */
  @Cron(CronExpression.EVERY_HOUR, { name: 'stale-expired-cleanup' })
  async cancelStale(): Promise<void> {
    const cancelled = await this.payments.cancelStaleExpiredReports();
    if (cancelled > 0) this.logger.log(`${cancelled} report kedaluwarsa dibatalkan.`);
  }

  /** Rekonsiliasi harian dengan laporan settlement gateway (AC-19). */
  @Cron('0 2 * * *', { name: 'daily-reconciliation', timeZone: 'Asia/Jakarta' })
  async reconcile(): Promise<void> {
    const result = await this.payments.reconcile();
    this.logger.log(
      `Rekonsiliasi harian: ${result.checked} pembayaran diperiksa, ${result.differences} selisih.`,
    );
  }

  /**
   * Verifikasi rantai hash audit dan penulisan checkpoint harian.
   *
   * Hash terakhir tiap hari diekspor ke object storage. Di lingkungan nyata
   * bucket checkpoint dikunci Object Lock (WORM), sehingga nilai pembanding
   * berada di luar jangkauan siapa pun yang dapat menulis ke database.
   */
  @Cron('0 1 * * *', { name: 'audit-checkpoint', timeZone: 'Asia/Jakarta' })
  async auditCheckpoint(): Promise<void> {
    const problems = await this.audit.verifyChain();

    if (problems.length > 0) {
      this.logger.error(
        `VERIFIKASI AUDIT GAGAL: ${problems.length} temuan. Pertama pada seq ${problems[0].badSeq}: ${problems[0].reason}`,
      );
    }

    const latest = await this.audit.latestCheckpoint();
    if (!latest) {
      this.logger.log('Belum ada entri audit; checkpoint dilewati.');
      return;
    }

    const forDate = new Date(new Date().toISOString().slice(0, 10));
    const payload = {
      forDate: forDate.toISOString().slice(0, 10),
      lastSeq: latest.seq.toString(),
      lastHash: latest.hash,
      verified: problems.length === 0,
      generatedAt: new Date().toISOString(),
    };

    const path = StorageService.auditCheckpointPath(payload.forDate);

    try {
      await this.storage.put(path, Buffer.from(JSON.stringify(payload, null, 2)), 'application/json');
    } catch (error) {
      this.logger.error(`Checkpoint audit gagal diunggah: ${(error as Error).message}`);
    }

    await this.prisma.auditCheckpoint.upsert({
      where: { forDate },
      update: {
        lastSeq: latest.seq,
        lastHash: latest.hash,
        verified: problems.length === 0,
        storagePath: path,
      },
      create: {
        forDate,
        lastSeq: latest.seq,
        lastHash: latest.hash,
        verified: problems.length === 0,
        storagePath: path,
      },
    });

    this.logger.log(
      `Checkpoint audit ${payload.forDate}: seq ${payload.lastSeq}, verifikasi ${
        problems.length === 0 ? 'lulus' : 'GAGAL'
      }.`,
    );
  }

  /** Membersihkan sesi kedaluwarsa agar tabel tidak tumbuh tanpa batas. */
  @Cron('30 3 * * *', { name: 'session-cleanup', timeZone: 'Asia/Jakarta' })
  async cleanupSessions(): Promise<void> {
    const cutoff = new Date(Date.now() - 30 * 86_400_000);
    const { count } = await this.prisma.userSession.deleteMany({
      where: { absoluteExpiresAt: { lt: cutoff } },
    });
    if (count > 0) this.logger.log(`${count} sesi lama dihapus.`);
  }

  /** Membersihkan challenge MFA yang sudah tidak berlaku. */
  @Cron('45 3 * * *', { name: 'mfa-cleanup', timeZone: 'Asia/Jakarta' })
  async cleanupMfaChallenges(): Promise<void> {
    const cutoff = new Date(Date.now() - 7 * 86_400_000);
    const { count } = await this.prisma.mfaChallenge.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    if (count > 0) this.logger.log(`${count} challenge MFA lama dihapus.`);
  }
}
