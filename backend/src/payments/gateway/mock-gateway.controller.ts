import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { AppConfig, CONFIG_TOKEN } from '../../common/config/configuration';
import { Public } from '../../common/security/decorators';
import { MockPaymentGateway } from './mock.gateway';

class SimulatePaymentDto {
  @Type(() => Number)
  @IsInt({ message: 'Jumlah bayar harus bilangan bulat rupiah.' })
  @Min(1)
  amount!: number;

  @IsOptional()
  @IsString()
  paymentMethod?: string;
}

class ReplayWebhookDto {
  @IsString()
  eventId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  times!: number;
}

/**
 * Sisi penyedia dari gateway simulasi.
 *
 * Hanya hidup ketika PAYMENT_DRIVER=mock; pada konfigurasi gateway nyata
 * seluruh endpoint di sini menolak permintaan. Bagian ini menggantikan halaman
 * pembayaran milik penyedia, sehingga alur webhook yang sesungguhnya —
 * tanda tangan, timestamp, dedupe, dan konfirmasi server-to-server — tetap
 * dapat dijalankan dan diuji secara lokal.
 */
@Controller('mock-gateway')
export class MockGatewayController {
  constructor(
    private readonly gateway: MockPaymentGateway,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
  ) {}

  private assertEnabled(): void {
    if (this.config.payment.driver !== 'mock') {
      throw new ForbiddenException('Gateway simulasi tidak aktif pada konfigurasi ini.');
    }
  }

  @Public()
  @Get('orders/:gatewayOrderId')
  async describe(@Param('gatewayOrderId') gatewayOrderId: string) {
    this.assertEnabled();
    const order = await this.gateway.describeOrder(gatewayOrderId);
    return {
      gatewayOrderId: order.gatewayOrderId,
      reportCode: order.reportCode,
      amount: order.amount,
      paidAmount: order.paidAmount,
      status: order.status,
      expired: order.expired,
      expiresAt: order.expiresAt,
      paymentMethod: order.paymentMethod,
    };
  }

  /**
   * Mensimulasikan pembayaran.
   * Jumlah boleh lebih kecil atau lebih besar dari tagihan agar jalur kurang
   * bayar dan lebih bayar dapat dicoba tanpa gateway sungguhan.
   */
  @Public()
  @Post('orders/:gatewayOrderId/pay')
  async pay(
    @Param('gatewayOrderId') gatewayOrderId: string,
    @Body() dto: SimulatePaymentDto,
  ) {
    this.assertEnabled();
    const result = await this.gateway.simulatePayment(
      gatewayOrderId,
      BigInt(dto.amount),
      dto.paymentMethod ?? 'VA_BCA',
    );
    return {
      message: 'Pembayaran simulasi dikirim ke webhook backend.',
      webhookDelivered: result.delivered,
      webhookHttpStatus: result.httpStatus,
    };
  }

  /** Mengirim ulang webhook dengan event_id yang sama (menguji AC-15). */
  @Public()
  @Post('orders/:gatewayOrderId/replay')
  async replay(
    @Param('gatewayOrderId') gatewayOrderId: string,
    @Body() dto: ReplayWebhookDto,
  ) {
    this.assertEnabled();
    const results = await this.gateway.replayWebhook(gatewayOrderId, dto.eventId, dto.times);
    return {
      message: `Webhook dengan event_id yang sama dikirim ${dto.times} kali.`,
      results,
    };
  }
}
