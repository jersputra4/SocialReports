import { Controller, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { RawBodyRequest } from '@nestjs/common';
import { Request } from 'express';
import { Public, RateLimit, SkipCsrf } from '../common/security/decorators';
import { PaymentsService } from './payments.service';

/**
 * Penerima webhook gateway pembayaran.
 *
 * Endpoint ini publik karena yang memanggilnya adalah penyedia pembayaran,
 * bukan peramban pengguna. Keasliannya dibuktikan tanda tangan HMAC pada body
 * mentah — karena itu CSRF tidak berlaku di sini dan sengaja dilewati.
 *
 * Balasan selalu cepat: verifikasi tanda tangan, simpan event, lalu antre.
 * Pemrosesan berat dikerjakan worker (BRD 6.3 poin 3).
 */
@Controller('webhooks/payments')
export class PaymentWebhooksController {
  constructor(private readonly payments: PaymentsService) {}

  @Public()
  @SkipCsrf()
  @RateLimit({ name: 'payment-webhook', limit: 600, windowSeconds: 60 })
  @Post(':provider')
  @HttpCode(HttpStatus.OK)
  async receive(
    @Param('provider') provider: string,
    @Req() request: RawBodyRequest<Request>,
  ) {
    // Body mentah dipakai apa adanya: tanda tangan dihitung atas byte yang
    // dikirim penyedia, bukan atas hasil serialisasi ulang.
    const rawBody = request.rawBody?.toString('utf8') ?? JSON.stringify(request.body ?? {});
    const result = await this.payments.receiveWebhook(provider, request.headers, rawBody);
    return { received: true, duplicate: result.duplicate };
  }
}
