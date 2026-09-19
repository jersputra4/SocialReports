import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AppConfig, CONFIG_TOKEN } from '../../common/config/configuration';
import { RedisService } from '../../common/redis/redis.service';
import { randomToken, signWebhook, verifyWebhookSignature } from '../../common/utils/crypto.util';
import {
  CreateOrderInput,
  CreateOrderResult,
  GatewayOrderStatus,
  OrderStatusResult,
  PaymentGateway,
  WebhookVerification,
} from './payment-gateway.interface';

interface MockOrder {
  gatewayOrderId: string;
  reportCode: string;
  amount: string;
  paidAmount: string;
  status: GatewayOrderStatus;
  paymentMethod?: string;
  expiresAt: string;
  paidAt?: string;
}

/**
 * Gateway simulasi untuk pengembangan lokal.
 *
 * Yang disimulasikan hanya sisi penyedia. Seluruh mekanisme yang penting tetap
 * nyata dan diuji: halaman checkout terpisah, webhook bertanda tangan HMAC
 * dengan timestamp, id event untuk deduplikasi, dan endpoint status
 * server-to-server. Karena itu berpindah ke gateway berlisensi tidak menuntut
 * perubahan pada alur pembayaran.
 *
 * Keadaan order disimpan di Redis dengan awalan `mockgw:` sehingga tidak
 * bercampur dengan tabel bisnis.
 */
@Injectable()
export class MockPaymentGateway implements PaymentGateway {
  readonly provider: string;
  private readonly logger = new Logger(MockPaymentGateway.name);

  constructor(
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
    private readonly redis: RedisService,
  ) {
    this.provider = config.payment.providerName;
  }

  private key(gatewayOrderId: string): string {
    return `mockgw:order:${gatewayOrderId}`;
  }

  async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    const order: MockOrder = {
      gatewayOrderId: input.gatewayOrderId,
      reportCode: input.reportCode,
      amount: input.amount.toString(),
      paidAmount: '0',
      status: 'PENDING',
      paymentMethod: input.preferredMethod,
      expiresAt: input.expiresAt.toISOString(),
    };

    const ttl = Math.max(
      60,
      Math.floor((input.expiresAt.getTime() - Date.now()) / 1000) + 7 * 86_400,
    );
    await this.redis.setEx(this.key(input.gatewayOrderId), JSON.stringify(order), ttl);

    return {
      gatewayOrderId: input.gatewayOrderId,
      checkoutUrl: `${this.config.publicUrl}/pembayaran/${input.gatewayOrderId}`,
      expiresAt: input.expiresAt,
    };
  }

  async getOrderStatus(gatewayOrderId: string): Promise<OrderStatusResult> {
    const order = await this.readOrder(gatewayOrderId);

    // Kedaluwarsa dihitung saat dibaca, seperti gateway sungguhan.
    let status = order.status;
    if (status === 'PENDING' && new Date(order.expiresAt).getTime() <= Date.now()) {
      status = 'EXPIRED';
    }

    return {
      gatewayOrderId,
      status,
      paidAmount: BigInt(order.paidAmount),
      currency: 'IDR',
      paymentMethod: order.paymentMethod,
      paidAt: order.paidAt ? new Date(order.paidAt) : undefined,
    };
  }

  /**
   * Header HTTP dapat berupa array bila dikirim berulang. Ambil nilai pertama
   * agar pemeriksaan tanda tangan selalu bekerja pada satu string.
   */
  private header(
    headers: Record<string, string | string[] | undefined>,
    name: string,
  ): string | undefined {
    const value = headers[name];
    return Array.isArray(value) ? value[0] : value;
  }

  verifyWebhook(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string,
  ): WebhookVerification {
    const signature = this.header(headers, 'x-signature');
    const timestamp = this.header(headers, 'x-timestamp');

    if (!signature || !timestamp) {
      return { valid: false, reason: 'header tanda tangan tidak lengkap' };
    }

    const check = verifyWebhookSignature(
      this.config.payment.webhookSecret,
      timestamp,
      rawBody,
      signature,
      this.config.notification.timestampToleranceSeconds,
    );
    if (!check.valid) return { valid: false, reason: check.reason };

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return { valid: false, reason: 'body bukan JSON' };
    }

    const providerEventId = typeof payload.event_id === 'string' ? payload.event_id : undefined;
    const gatewayOrderId = typeof payload.order_id === 'string' ? payload.order_id : undefined;
    if (!providerEventId || !gatewayOrderId) {
      return { valid: false, reason: 'event_id atau order_id tidak ada' };
    }

    return {
      valid: true,
      providerEventId,
      gatewayOrderId,
      status: payload.status as GatewayOrderStatus,
      amount: typeof payload.amount === 'string' ? BigInt(payload.amount) : undefined,
      paymentMethod: typeof payload.payment_method === 'string' ? payload.payment_method : undefined,
      payload,
    };
  }

  // ------------------------------------------- sisi "penyedia" untuk simulasi

  /** Dipakai halaman checkout simulasi untuk menampilkan ringkasan order. */
  async describeOrder(gatewayOrderId: string): Promise<MockOrder & { expired: boolean }> {
    const order = await this.readOrder(gatewayOrderId);
    return { ...order, expired: new Date(order.expiresAt).getTime() <= Date.now() };
  }

  /**
   * Mensimulasikan pengguna membayar.
   * `amount` boleh kurang atau lebih dari tagihan agar jalur kurang bayar dan
   * lebih bayar dapat dicoba (BRD 6.3 "Kasus khusus", AC-17).
   */
  async simulatePayment(
    gatewayOrderId: string,
    amount: bigint,
    paymentMethod: string,
  ): Promise<{ delivered: boolean; httpStatus: number }> {
    const order = await this.readOrder(gatewayOrderId);

    if (new Date(order.expiresAt).getTime() <= Date.now()) {
      throw new NotFoundException('Order pembayaran sudah kedaluwarsa.');
    }

    const paid = BigInt(order.paidAmount) + amount;
    const updated: MockOrder = {
      ...order,
      paidAmount: paid.toString(),
      paymentMethod,
      status: paid >= BigInt(order.amount) ? 'PAID' : 'PENDING',
      paidAt: new Date().toISOString(),
    };

    await this.redis.setEx(this.key(gatewayOrderId), JSON.stringify(updated), 14 * 86_400);

    return this.deliverWebhook({
      event_id: `evt_${randomToken(12)}`,
      order_id: gatewayOrderId,
      status: updated.status === 'PAID' ? 'PAID' : 'PENDING',
      amount: paid.toString(),
      payment_method: paymentMethod,
      occurred_at: new Date().toISOString(),
    });
  }

  /** Mensimulasikan webhook duplikat — dipakai menguji idempotency (AC-15). */
  async replayWebhook(
    gatewayOrderId: string,
    eventId: string,
    times: number,
  ): Promise<Array<{ delivered: boolean; httpStatus: number }>> {
    const order = await this.readOrder(gatewayOrderId);
    const body = {
      event_id: eventId,
      order_id: gatewayOrderId,
      status: order.status,
      amount: order.paidAmount,
      payment_method: order.paymentMethod ?? 'VA_BCA',
      occurred_at: new Date().toISOString(),
    };

    return Promise.all(Array.from({ length: times }, () => this.deliverWebhook(body)));
  }

  private async deliverWebhook(
    body: Record<string, unknown>,
  ): Promise<{ delivered: boolean; httpStatus: number }> {
    const raw = JSON.stringify(body);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = signWebhook(this.config.payment.webhookSecret, timestamp, raw);

    const url = `http://127.0.0.1:${this.config.port}/api/v1/webhooks/payments/${this.provider}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-signature': signature,
          'x-timestamp': timestamp,
        },
        body: raw,
      });
      return { delivered: response.ok, httpStatus: response.status };
    } catch (error) {
      this.logger.error(`Gagal mengirim webhook simulasi: ${(error as Error).message}`);
      return { delivered: false, httpStatus: 0 };
    }
  }

  private async readOrder(gatewayOrderId: string): Promise<MockOrder> {
    const raw = await this.redis.get(this.key(gatewayOrderId));
    if (!raw) throw new NotFoundException('Order pembayaran tidak ditemukan.');
    return JSON.parse(raw) as MockOrder;
  }
}
