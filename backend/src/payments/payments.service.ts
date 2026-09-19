import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, Report } from '@prisma/client';
import { AppConfig, CONFIG_TOKEN } from '../common/config/configuration';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AuditAction } from '../common/audit/audit-actions';
import { JobName, QueueName, QueueService } from '../common/queue/queue.service';
import { formatGatewayOrderId, formatInvoiceNumber } from '../common/utils/codes.util';
import { ReportTransitionService } from '../reports/report-transition.service';
import { PAYMENT_GATEWAY, PaymentGateway } from './gateway/payment-gateway.interface';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly transitions: ReportTransitionService,
    private readonly queue: QueueService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
  ) {}

  // -------------------------------------------------------------- checkout --

  /**
   * Membuat order pembayaran untuk report yang sudah dibekukan snapshotnya.
   *
   * `payment_id` internal dipakai sebagai idempotency key ke gateway (BRD 6.3
   * poin 1), sehingga percobaan ulang jaringan tidak menghasilkan dua tagihan.
   */
  async createOrder(
    tx: Prisma.TransactionClient,
    report: Report,
    preferredMethod?: string,
  ): Promise<{ gatewayOrderId: string; checkoutUrl: string; expiresAt: Date }> {
    if (
      report.subtotalSnapshot === null ||
      report.taxAmountSnapshot === null ||
      report.totalAmountSnapshot === null
    ) {
      throw new BadRequestException('Rincian harga report belum lengkap.');
    }

    const active = await tx.payment.findFirst({
      where: { reportId: report.id, status: { in: ['PENDING', 'MANUAL_REVIEW'] } },
    });
    if (active) {
      throw new ConflictException(
        'Masih ada tagihan aktif untuk report ini. Selesaikan atau tunggu kedaluwarsa.',
      );
    }

    const attempt = (await tx.payment.count({ where: { reportId: report.id } })) + 1;
    const gatewayOrderId = formatGatewayOrderId(report.reportCode, attempt);
    const expiresAt = new Date(Date.now() + this.config.payment.expiryHours * 3_600_000);

    const payment = await tx.payment.create({
      data: {
        reportId: report.id,
        provider: this.gateway.provider,
        gatewayOrderId,
        paymentMethod: preferredMethod,
        subtotal: report.subtotalSnapshot,
        taxAmount: report.taxAmountSnapshot,
        totalAmount: report.totalAmountSnapshot,
        status: 'PENDING',
        expiresAt,
      },
    });

    const order = await this.gateway.createOrder({
      paymentId: payment.id,
      gatewayOrderId,
      reportCode: report.reportCode,
      amount: report.totalAmountSnapshot,
      currency: 'IDR',
      expiresAt,
      customerReference: report.reportCode,
      preferredMethod,
    });

    await tx.payment.update({
      where: { id: payment.id },
      data: { checkoutUrl: order.checkoutUrl },
    });

    await this.audit.record(
      {
        action: AuditAction.PAYMENT_UPDATE,
        entityType: 'payment',
        entityId: gatewayOrderId,
        after: {
          event: 'ORDER_CREATED',
          totalAmount: report.totalAmountSnapshot.toString(),
          expiresAt: expiresAt.toISOString(),
        },
      },
      tx,
    );

    return { gatewayOrderId, checkoutUrl: order.checkoutUrl, expiresAt };
  }

  // --------------------------------------------------------------- webhook --

  /**
   * Menerima webhook gateway.
   *
   * Tiga hal yang dijaga di sini (BRD 6.3 poin 3, AC-14, AC-15):
   *   1. tanda tangan diperiksa sebelum apa pun dikerjakan;
   *   2. event disimpan dengan unique (provider, provider_event_id) sehingga
   *      pengiriman berulang — termasuk yang paralel — hanya tercatat sekali;
   *   3. balasan 200 dikirim cepat, pemrosesan berat masuk antrean.
   */
  async receiveWebhook(
    provider: string,
    headers: Record<string, string | string[] | undefined>,
    rawBody: string,
  ): Promise<{ accepted: boolean; duplicate: boolean }> {
    const verification = this.gateway.verifyWebhook(headers, rawBody);

    if (!verification.valid) {
      await this.prisma.webhookEvent
        .create({
          data: {
            provider,
            providerEventId: `invalid-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
            signatureValid: false,
            rawPayload: this.safeJson(rawBody),
            processError: verification.reason?.slice(0, 512),
          },
        })
        .catch(() => undefined);

      await this.audit.record({
        action: AuditAction.PAYMENT_UPDATE,
        entityType: 'webhook',
        entityId: provider,
        after: { event: 'SIGNATURE_REJECTED', reason: verification.reason },
      });

      // 401, bukan 400: gateway harus tahu ini soal keaslian, bukan bentuk data.
      throw new UnauthorizedException({
        error: 'InvalidSignature',
        message: 'Tanda tangan webhook tidak valid.',
      });
    }

    try {
      const event = await this.prisma.webhookEvent.create({
        data: {
          provider,
          providerEventId: verification.providerEventId!,
          signatureValid: true,
          rawPayload: this.safeJson(rawBody),
        },
      });

      await this.queue.enqueue(
        QueueName.PAYMENTS,
        JobName.PROCESS_WEBHOOK,
        { webhookEventId: event.id },
        { jobId: `webhook:${event.id}` },
      );

      return { accepted: true, duplicate: false };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // Event yang sama datang lagi: tidak ada pemrosesan kedua, tetap 200.
        this.logger.log(
          `Webhook duplikat diabaikan: ${provider}/${verification.providerEventId}`,
        );
        return { accepted: true, duplicate: true };
      }
      throw error;
    }
  }

  private safeJson(raw: string): Prisma.InputJsonValue {
    try {
      return JSON.parse(raw) as Prisma.InputJsonValue;
    } catch {
      return { raw: raw.slice(0, 4000) } as Prisma.InputJsonValue;
    }
  }

  /**
   * Pemrosesan webhook — dijalankan worker.
   *
   * Status dari webhook tidak langsung dipercaya: status dikonfirmasi ulang ke
   * gateway lewat panggilan server-to-server, lalu seluruh perubahan ditulis
   * dalam SATU transaksi bersama audit dan outbox.
   */
  async processWebhookEvent(webhookEventId: string): Promise<void> {
    const event = await this.prisma.webhookEvent.findUnique({ where: { id: webhookEventId } });
    if (!event) throw new NotFoundException('Event webhook tidak ditemukan.');
    if (event.processedAt) {
      this.logger.log(`Event ${webhookEventId} sudah diproses sebelumnya.`);
      return;
    }

    const payload = event.rawPayload as Record<string, unknown>;
    const gatewayOrderId = typeof payload.order_id === 'string' ? payload.order_id : undefined;
    if (!gatewayOrderId) {
      await this.markEventFailed(webhookEventId, 'order_id tidak ada pada payload');
      return;
    }

    const payment = await this.prisma.payment.findUnique({
      where: { gatewayOrderId },
      include: { report: true },
    });
    if (!payment) {
      await this.markEventFailed(webhookEventId, `order ${gatewayOrderId} tidak dikenal`);
      return;
    }

    // Konfirmasi server-to-server (BRD 6.3 poin 4).
    const status = await this.gateway.getOrderStatus(gatewayOrderId);

    if (status.currency !== 'IDR') {
      await this.markEventFailed(webhookEventId, `mata uang ${status.currency} tidak didukung`);
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      const fresh = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });

      await tx.paymentTransaction.create({
        data: {
          paymentId: fresh.id,
          providerEventId: event.providerEventId,
          rawPayload: event.rawPayload as Prisma.InputJsonValue,
          status: status.status,
          amount: status.paidAmount,
        },
      });

      const total = fresh.totalAmount;
      const paid = status.paidAmount;

      if (status.status === 'PAID' || paid >= total) {
        const overpaid = paid > total ? paid - total : 0n;

        await tx.payment.update({
          where: { id: fresh.id },
          data: {
            status: 'SETTLED',
            paidAmount: paid,
            overpaidAmount: overpaid,
            paymentMethod: status.paymentMethod ?? fresh.paymentMethod,
            paidAt: status.paidAt ?? new Date(),
          },
        });

        if (['WAITING_PAYMENT', 'PAYMENT_REVIEW'].includes(payment.report.status)) {
          await this.transitions.transitionWithin(tx, {
            reportId: payment.reportId,
            to: 'PAID',
            actor: 'SYSTEM',
            actorRole: 'system',
            reason:
              payment.report.status === 'PAYMENT_REVIEW'
                ? 'Pembayaran tambahan mencukupi tagihan'
                : null,
          });

          await this.issueInvoice(tx, payment.reportId);

          // BRD 7.2 baris 12: PAID otomatis berlanjut ke antrean review.
          await this.transitions.transitionWithin(tx, {
            reportId: payment.reportId,
            to: 'WAITING_REVIEW',
            actor: 'SYSTEM',
            actorRole: 'system',
          });
        }

        await this.audit.record(
          {
            action: AuditAction.PAYMENT_VERIFY,
            entityType: 'payment',
            entityId: gatewayOrderId,
            actorRole: 'system',
            after: {
              paidAmount: paid.toString(),
              totalAmount: total.toString(),
              overpaidAmount: overpaid.toString(),
            },
          },
          tx,
        );
      } else if (paid > 0n && paid < total) {
        // Kurang bayar: masuk peninjauan manual, TIDAK otomatis menjadi lunas.
        await tx.payment.update({
          where: { id: fresh.id },
          data: {
            status: 'MANUAL_REVIEW',
            paidAmount: paid,
            paymentMethod: status.paymentMethod ?? fresh.paymentMethod,
          },
        });

        if (payment.report.status === 'WAITING_PAYMENT') {
          await this.transitions.transitionWithin(tx, {
            reportId: payment.reportId,
            to: 'PAYMENT_REVIEW',
            actor: 'SYSTEM',
            actorRole: 'system',
            reason: `Kurang bayar: diterima ${paid} dari ${total}`,
          });
        }

        await this.audit.record(
          {
            action: AuditAction.PAYMENT_UPDATE,
            entityType: 'payment',
            entityId: gatewayOrderId,
            actorRole: 'system',
            after: { event: 'UNDERPAID', paidAmount: paid.toString(), totalAmount: total.toString() },
          },
          tx,
        );
      }

      await tx.webhookEvent.update({
        where: { id: webhookEventId },
        data: { processedAt: new Date() },
      });
    });
  }

  private async markEventFailed(webhookEventId: string, reason: string): Promise<void> {
    this.logger.warn(`Webhook ${webhookEventId} ditolak: ${reason}`);
    await this.prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: { processedAt: new Date(), processError: reason.slice(0, 512) },
    });
  }

  // --------------------------------------------------------------- invoice --

  /**
   * Menerbitkan invoice saat report menjadi PAID (BRD 6.5).
   * Nomor diambil dari sequence database agar unik dan berurutan walaupun ada
   * beberapa instance API.
   */
  private async issueInvoice(tx: Prisma.TransactionClient, reportId: string): Promise<void> {
    const existing = await tx.invoice.findFirst({ where: { reportId } });
    if (existing) return;

    const report = await tx.report.findUniqueOrThrow({ where: { id: reportId } });
    const year = new Date().getFullYear();

    const [{ nextval }] = await tx.$queryRaw<Array<{ nextval: bigint }>>(
      Prisma.sql`SELECT nextval('invoice_number_seq') AS nextval`,
    );

    await tx.invoice.create({
      data: {
        invoiceNumber: formatInvoiceNumber(year, Number(nextval)),
        reportId,
        subtotal: report.subtotalSnapshot!,
        taxRateBp: report.taxRateBpSnapshot!,
        taxAmount: report.taxAmountSnapshot!,
        total: report.totalAmountSnapshot!,
      },
    });
  }

  // -------------------------------------------------------- tindakan admin --

  async listForReview() {
    const payments = await this.prisma.payment.findMany({
      where: { status: 'MANUAL_REVIEW' },
      orderBy: { createdAt: 'asc' },
      include: { report: { select: { reportCode: true, status: true } } },
    });

    return payments.map((payment) => ({
      gatewayOrderId: payment.gatewayOrderId,
      reportCode: payment.report.reportCode,
      reportStatus: payment.report.status,
      totalAmount: payment.totalAmount.toString(),
      paidAmount: payment.paidAmount.toString(),
      shortfall: (payment.totalAmount - payment.paidAmount).toString(),
      createdAt: payment.createdAt,
      expiresAt: payment.expiresAt,
    }));
  }

  /**
   * Keputusan Finance atas pembayaran yang tertahan (BRD 7.2 baris 7-8).
   * Tidak ada jalur refund: keputusan hanya "lanjutkan" atau "tolak".
   */
  async resolveManualReview(input: {
    gatewayOrderId: string;
    decision: 'ACCEPT' | 'REJECT';
    reason: string;
    actorId: string;
    actorRole: string;
  }): Promise<{ reportCode: string; status: string }> {
    if (input.reason.trim().length < 10) {
      throw new BadRequestException('Alasan wajib diisi minimal 10 karakter.');
    }

    const payment = await this.prisma.payment.findUnique({
      where: { gatewayOrderId: input.gatewayOrderId },
      include: { report: true },
    });
    if (!payment) throw new NotFoundException('Pembayaran tidak ditemukan.');
    if (payment.status !== 'MANUAL_REVIEW') {
      throw new ConflictException('Pembayaran ini tidak sedang menunggu peninjauan.');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.paymentVerification.create({
        data: {
          paymentId: payment.id,
          reason: input.reason,
          decision: input.decision,
          verifiedBy: input.actorId,
        },
      });

      if (input.decision === 'ACCEPT') {
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: 'SETTLED', paidAt: new Date() },
        });

        await this.transitions.transitionWithin(tx, {
          reportId: payment.reportId,
          to: 'PAID',
          actor: 'FINANCE',
          actorId: input.actorId,
          actorRole: input.actorRole,
          reason: input.reason,
        });

        await this.issueInvoice(tx, payment.reportId);

        await this.transitions.transitionWithin(tx, {
          reportId: payment.reportId,
          to: 'WAITING_REVIEW',
          actor: 'SYSTEM',
          actorRole: 'system',
        });
      } else {
        await tx.payment.update({ where: { id: payment.id }, data: { status: 'FAILED' } });

        await this.transitions.transitionWithin(tx, {
          reportId: payment.reportId,
          to: 'PAYMENT_REJECTED',
          actor: 'FINANCE',
          actorId: input.actorId,
          actorRole: input.actorRole,
          reason: input.reason,
        });
      }

      await this.audit.record(
        {
          action: AuditAction.PAYMENT_VERIFY,
          entityType: 'payment',
          entityId: input.gatewayOrderId,
          actorId: input.actorId,
          after: { decision: input.decision, reason: input.reason },
        },
        tx,
      );

      const report = await tx.report.findUniqueOrThrow({ where: { id: payment.reportId } });
      return { reportCode: report.reportCode, status: report.status };
    });
  }

  // --------------------------------------------------- pekerjaan terjadwal --

  /** Menutup order yang melewati batas waktu (BRD 7.2 baris 5, AC-16). */
  async expireOverduePayments(): Promise<number> {
    const overdue = await this.prisma.payment.findMany({
      where: { status: 'PENDING', expiresAt: { lt: new Date() } },
      include: { report: true },
      take: 200,
    });

    let count = 0;
    for (const payment of overdue) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.payment.update({ where: { id: payment.id }, data: { status: 'EXPIRED' } });
          if (payment.report.status === 'WAITING_PAYMENT') {
            await this.transitions.transitionWithin(tx, {
              reportId: payment.reportId,
              to: 'EXPIRED',
              actor: 'SYSTEM',
              actorRole: 'system',
            });
          }
        });
        count += 1;
      } catch (error) {
        this.logger.error(
          `Gagal menutup order ${payment.gatewayOrderId}: ${(error as Error).message}`,
        );
      }
    }
    return count;
  }

  /** Membatalkan report yang sudah lewat 7 hari sejak kedaluwarsa (baris 11). */
  async cancelStaleExpiredReports(): Promise<number> {
    const cutoff = new Date(Date.now() - this.config.payment.retryWindowDays * 86_400_000);
    const stale = await this.prisma.report.findMany({
      where: { status: 'EXPIRED', expiredAt: { lt: cutoff } },
      take: 200,
    });

    let count = 0;
    for (const report of stale) {
      try {
        await this.transitions.transition({
          reportId: report.id,
          to: 'CANCELLED',
          actor: 'SYSTEM',
          actorRole: 'system',
          reason: `Tidak ada pembayaran ulang dalam ${this.config.payment.retryWindowDays} hari`,
        });
        count += 1;
      } catch (error) {
        this.logger.error(
          `Gagal membatalkan report ${report.reportCode}: ${(error as Error).message}`,
        );
      }
    }
    return count;
  }

  /**
   * Rekonsiliasi harian (BRD 6.3, AC-19).
   * Membandingkan status di gateway dengan status di database, mencatat
   * selisihnya, dan memicu alert lewat event SYSTEM_ERROR bila ada.
   */
  async reconcile(runDate: Date = new Date()): Promise<{ checked: number; differences: number }> {
    const since = new Date(runDate.getTime() - 3 * 86_400_000);
    const payments = await this.prisma.payment.findMany({
      where: { createdAt: { gte: since } },
      take: 1000,
    });

    let differences = 0;

    for (const payment of payments) {
      try {
        const status = await this.gateway.getOrderStatus(payment.gatewayOrderId);
        const expectedSettled = payment.status === 'SETTLED';
        const gatewaySettled = status.status === 'PAID';
        const amountDiff = status.paidAmount - payment.paidAmount;

        if (expectedSettled === gatewaySettled && amountDiff === 0n) continue;

        differences += 1;
        await this.prisma.paymentReconciliation.create({
          data: {
            runDate: new Date(runDate.toISOString().slice(0, 10)),
            paymentId: payment.id,
            gatewayStatus: status.status,
            dbStatus: payment.status,
            difference: amountDiff,
            note: `Gateway ${status.paidAmount} vs database ${payment.paidAmount}`,
          },
        });

        await this.audit.record({
          action: AuditAction.PAYMENT_RECONCILE,
          entityType: 'payment',
          entityId: payment.gatewayOrderId,
          actorRole: 'system',
          after: {
            gatewayStatus: status.status,
            dbStatus: payment.status,
            difference: amountDiff.toString(),
          },
        });
      } catch (error) {
        this.logger.warn(
          `Rekonsiliasi ${payment.gatewayOrderId} gagal: ${(error as Error).message}`,
        );
      }
    }

    return { checked: payments.length, differences };
  }

  async listReconciliations(limit = 100) {
    const rows = await this.prisma.paymentReconciliation.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { payment: { select: { gatewayOrderId: true } } },
    });

    return rows.map((row) => ({
      id: row.id,
      runDate: row.runDate,
      gatewayOrderId: row.payment?.gatewayOrderId ?? null,
      gatewayStatus: row.gatewayStatus,
      dbStatus: row.dbStatus,
      difference: row.difference.toString(),
      note: row.note,
      resolvedAt: row.resolvedAt,
    }));
  }

  async resolveReconciliation(id: string, actorId: string): Promise<void> {
    await this.prisma.paymentReconciliation.update({
      where: { id },
      data: { resolvedBy: actorId, resolvedAt: new Date() },
    });
    await this.audit.record({
      action: AuditAction.PAYMENT_RECONCILE,
      entityType: 'payment_reconciliation',
      entityId: id,
      actorId,
      after: { resolved: true },
    });
  }
}
