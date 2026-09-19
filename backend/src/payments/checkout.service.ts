import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AuditAction } from '../common/audit/audit-actions';
import { ReportsService } from '../reports/reports.service';
import { ReportTransitionService } from '../reports/report-transition.service';
import { PaymentsService } from './payments.service';

/** Versi dokumen persetujuan yang berlaku. Perubahan teks menaikkan versinya. */
export const NO_REFUND_DOCUMENT_VERSION = '1.1';

@Injectable()
export class CheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly reports: ReportsService,
    private readonly transitions: ReportTransitionService,
    private readonly payments: PaymentsService,
  ) {}

  /**
   * Menutup tahap penyusunan report dan membuka tagihan.
   *
   * Urutan di dalam satu transaksi:
   *   1. persetujuan "tanpa refund" dicatat beserta versi dokumen, waktu, dan
   *      alamat IP (BRD 6.4, AC-18);
   *   2. snapshot harga/PPN/policy/legal/target dibekukan;
   *   3. order gateway dibuat;
   *   4. status berpindah DRAFT -> WAITING_PAYMENT.
   *
   * Bila salah satu langkah gagal, seluruhnya dibatalkan — tidak ada report
   * yang berstatus menunggu pembayaran tanpa tagihan, dan tidak ada tagihan
   * tanpa persetujuan.
   */
  async checkout(input: {
    userId: string;
    reportCode: string;
    noRefundConsentVersion: string;
    paymentMethod?: string;
    ipAddress?: string;
  }): Promise<{ reportCode: string; gatewayOrderId: string; checkoutUrl: string; expiresAt: Date }> {
    if (input.noRefundConsentVersion !== NO_REFUND_DOCUMENT_VERSION) {
      throw new BadRequestException(
        'Versi ketentuan yang Anda setujui sudah tidak berlaku. Muat ulang halaman lalu setujui ulang.',
      );
    }

    const report = await this.reports.resolveOwnedReport(input.userId, input.reportCode);

    if (!['DRAFT', 'EXPIRED', 'PAYMENT_REJECTED'].includes(report.status)) {
      throw new ConflictException(
        `Report berstatus ${report.status} tidak dapat dibuatkan tagihan baru.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.userConsent.create({
        data: {
          userId: input.userId,
          documentType: 'NO_REFUND',
          documentVersion: NO_REFUND_DOCUMENT_VERSION,
          ipAddress: input.ipAddress?.slice(0, 64),
          reportId: report.id,
        },
      });

      // Snapshot hanya dibekukan sekali; percobaan bayar ulang memakai harga
      // yang berlaku saat itu, sesuai BRD 7.2 baris 9 dan 10.
      const sealed = report.snapshotSealedAt
        ? await tx.report.findUniqueOrThrow({ where: { id: report.id } })
        : await this.reports.sealSnapshot(tx, report.id);

      const order = await this.payments.createOrder(tx, sealed, input.paymentMethod);

      await this.transitions.transitionWithin(tx, {
        reportId: report.id,
        to: 'WAITING_PAYMENT',
        actor: 'USER',
        actorId: input.userId,
        actorRole: 'user',
      });

      await this.audit.record(
        {
          action: AuditAction.UPDATE_REPORT,
          entityType: 'report',
          entityId: report.reportCode,
          actorId: input.userId,
          after: {
            event: 'CHECKOUT',
            consentVersion: NO_REFUND_DOCUMENT_VERSION,
            gatewayOrderId: order.gatewayOrderId,
          },
        },
        tx,
      );

      return {
        reportCode: report.reportCode,
        gatewayOrderId: order.gatewayOrderId,
        checkoutUrl: order.checkoutUrl,
        expiresAt: order.expiresAt,
      };
    });
  }

  /**
   * Membuat tagihan ulang setelah kedaluwarsa atau penolakan pembayaran.
   * Harga dihitung ulang memakai konfigurasi yang berlaku saat ini — snapshot
   * lama tetap tersimpan sebagai riwayat, tetapi nilai tagihan mengikuti
   * konfigurasi baru (BRD 7.2 baris 9-10).
   */
  async retry(input: {
    userId: string;
    reportCode: string;
    paymentMethod?: string;
    ipAddress?: string;
  }) {
    const report = await this.reports.resolveOwnedReport(input.userId, input.reportCode);

    if (!['EXPIRED', 'PAYMENT_REJECTED'].includes(report.status)) {
      throw new ConflictException('Report ini tidak sedang menunggu pembayaran ulang.');
    }

    return this.prisma.$transaction(async (tx) => {
      // Kuotasi ulang dengan harga dan tarif pajak yang berlaku saat ini.
      // Trigger database mengizinkan ini hanya pada status EXPIRED dan
      // PAYMENT_REJECTED (migrasi 0007); di status lain snapshot tetap beku.
      const refreshed = await this.reports.sealSnapshot(tx, report.id);
      const order = await this.payments.createOrder(tx, refreshed, input.paymentMethod);

      await this.transitions.transitionWithin(tx, {
        reportId: report.id,
        to: 'WAITING_PAYMENT',
        actor: 'USER',
        actorId: input.userId,
        actorRole: 'user',
      });

      return {
        reportCode: report.reportCode,
        gatewayOrderId: order.gatewayOrderId,
        checkoutUrl: order.checkoutUrl,
        expiresAt: order.expiresAt,
      };
    });
  }
}
