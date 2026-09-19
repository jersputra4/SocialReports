import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AuthenticatedRequest, AuthenticatedUser } from '../common/security/auth.types';
import { CurrentUser, RequirePermissions } from '../common/security/decorators';
import { CheckoutDto } from '../reports/dto/report.dto';
import { CheckoutService } from './checkout.service';
import { PaymentsService } from './payments.service';

class ResolveManualReviewDto {
  @IsIn(['ACCEPT', 'REJECT'])
  decision!: 'ACCEPT' | 'REJECT';

  @IsString()
  @MinLength(10, { message: 'Alasan wajib diisi minimal 10 karakter.' })
  @MaxLength(2000)
  reason!: string;
}

class RetryPaymentDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  paymentMethod?: string;
}

@Controller()
export class PaymentsController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly payments: PaymentsService,
  ) {}

  // ----------------------------------------------------------- sisi user ----

  /** Menyetujui ketentuan, membekukan snapshot, dan membuka tagihan. */
  @Post('reports/:reportCode/checkout')
  async createCheckout(
    @Param('reportCode') reportCode: string,
    @Body() dto: CheckoutDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
  ) {
    const result = await this.checkout.checkout({
      userId: user.id,
      reportCode,
      noRefundConsentVersion: dto.noRefundConsentVersion,
      paymentMethod: dto.paymentMethod,
      ipAddress: request.ip,
    });
    return { ...result, expiresAt: result.expiresAt.toISOString() };
  }

  /** Tagihan baru setelah kedaluwarsa atau pembayaran ditolak. */
  @Post('reports/:reportCode/payment/retry')
  async retry(
    @Param('reportCode') reportCode: string,
    @Body() dto: RetryPaymentDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
  ) {
    const result = await this.checkout.retry({
      userId: user.id,
      reportCode,
      paymentMethod: dto.paymentMethod,
      ipAddress: request.ip,
    });
    return { ...result, expiresAt: result.expiresAt.toISOString() };
  }

  @Get('payment-methods')
  listMethods() {
    return [
      { code: 'VA_MANDIRI', name: 'Virtual Account Mandiri', group: 'VIRTUAL_ACCOUNT' },
      { code: 'VA_BRI', name: 'Virtual Account BRI', group: 'VIRTUAL_ACCOUNT' },
      { code: 'VA_BNI', name: 'Virtual Account BNI', group: 'VIRTUAL_ACCOUNT' },
      { code: 'GOPAY', name: 'GoPay', group: 'EWALLET' },
      { code: 'DANA', name: 'DANA', group: 'EWALLET' },
      { code: 'SHOPEEPAY', name: 'ShopeePay', group: 'EWALLET' },
    ];
  }

  // ---------------------------------------------------------- sisi admin ----

  @Get('admin/payments/review')
  @RequirePermissions('payment.verify')
  listForReview() {
    return this.payments.listForReview();
  }

  @Post('admin/payments/:gatewayOrderId/resolve')
  @RequirePermissions('payment.verify')
  resolve(
    @Param('gatewayOrderId') gatewayOrderId: string,
    @Body() dto: ResolveManualReviewDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.payments.resolveManualReview({
      gatewayOrderId,
      decision: dto.decision,
      reason: dto.reason,
      actorId: user.id,
      actorRole: user.roleCode,
    });
  }

  @Get('admin/reconciliations')
  @RequirePermissions('payment.verify')
  listReconciliations(@Query('limit') limit?: string) {
    const parsed = Number.parseInt(limit ?? '', 10);
    return this.payments.listReconciliations(Number.isFinite(parsed) ? parsed : 100);
  }

  @Post('admin/reconciliations/:id/resolve')
  @RequirePermissions('payment.verify')
  async resolveReconciliation(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    await this.payments.resolveReconciliation(id, user.id);
    return { message: 'Selisih ditandai sudah ditindaklanjuti.' };
  }

  /** Menjalankan rekonsiliasi di luar jadwal harian. */
  @Post('admin/reconciliations/run')
  @RequirePermissions('payment.verify')
  run() {
    return this.payments.reconcile();
  }
}
