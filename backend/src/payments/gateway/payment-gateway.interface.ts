/**
 * Antarmuka payment gateway.
 *
 * Kode bisnis hanya mengenal antarmuka ini. Mengganti penyedia berarti menulis
 * satu kelas baru dan mengubah PAYMENT_DRIVER — alur report, idempotency,
 * rekonsiliasi, dan audit tidak ikut berubah.
 *
 * Implementasi `mock` dipakai untuk pengembangan lokal. Implementasi nyata
 * (Midtrans/Xendit/dll.) tinggal mengisi metode yang sama.
 */

export interface CreateOrderInput {
  /** Id internal kami; dipakai sebagai idempotency key ke gateway (BRD 6.3). */
  paymentId: string;
  gatewayOrderId: string;
  reportCode: string;
  amount: bigint;
  currency: 'IDR';
  expiresAt: Date;
  customerReference: string;
  preferredMethod?: string;
}

export interface CreateOrderResult {
  gatewayOrderId: string;
  checkoutUrl: string;
  expiresAt: Date;
}

export type GatewayOrderStatus = 'PENDING' | 'PAID' | 'EXPIRED' | 'FAILED';

export interface OrderStatusResult {
  gatewayOrderId: string;
  status: GatewayOrderStatus;
  paidAmount: bigint;
  currency: string;
  paymentMethod?: string;
  paidAt?: Date;
}

export interface WebhookVerification {
  valid: boolean;
  reason?: string;
  /** Id event dari penyedia — dasar deduplikasi (AC-15). */
  providerEventId?: string;
  gatewayOrderId?: string;
  status?: GatewayOrderStatus;
  amount?: bigint;
  paymentMethod?: string;
  payload?: Record<string, unknown>;
}

export interface PaymentGateway {
  readonly provider: string;

  createOrder(input: CreateOrderInput): Promise<CreateOrderResult>;

  /**
   * Konfirmasi server-to-server. Webhook TIDAK pernah dipercaya sendirian;
   * status selalu dikonfirmasi lewat metode ini sebelum status report berubah
   * (BRD 6.3 poin 4, AC-14).
   */
  getOrderStatus(gatewayOrderId: string): Promise<OrderStatusResult>;

  verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: string): WebhookVerification;
}

export const PAYMENT_GATEWAY = 'PAYMENT_GATEWAY';
