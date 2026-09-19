import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsDate, IsInt, IsPositive, Max, Min } from 'class-validator';
import { AuthenticatedUser } from '../common/security/auth.types';
import {
  CurrentUser,
  RequirePermissions,
  RequireStepUpMfa,
} from '../common/security/decorators';
import { PricingService } from './pricing.service';

class SchedulePriceDto {
  @Type(() => Number)
  @IsInt({ message: 'Harga satuan harus bilangan bulat rupiah.' })
  @IsPositive()
  unitPrice!: number;

  @Type(() => Date)
  @IsDate()
  effectiveFrom!: Date;
}

class ScheduleTaxDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  rateBp!: number;

  @Type(() => Date)
  @IsDate()
  effectiveFrom!: Date;
}

@Controller()
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  /** Katalog paket dengan rincian subtotal, PPN, dan total (AC-11). */
  @Get('packages')
  catalogue() {
    return this.pricing.catalogue();
  }

  @Get('pricing/quote')
  async quote(@Query('quantity') quantity: string) {
    const parsed = Number.parseInt(quantity, 10);
    const result = await this.pricing.quote(Number.isFinite(parsed) ? parsed : 0);
    return {
      quantity: result.quantity,
      unitPrice: result.unitPrice.toString(),
      subtotal: result.subtotal.toString(),
      taxName: result.taxName,
      taxRateBp: result.taxRateBp,
      taxAmount: result.taxAmount.toString(),
      totalAmount: result.totalAmount.toString(),
    };
  }

  // --------------------------------------------------------------- admin ----

  @Get('admin/pricing')
  @RequirePermissions('pricing.manage')
  async history() {
    const [prices, taxes] = await Promise.all([
      this.pricing.listPricingHistory(),
      this.pricing.listTaxHistory(),
    ]);
    return {
      pricing: prices.map((p) => ({
        id: p.id,
        unitPrice: p.unitPrice.toString(),
        effectiveFrom: p.effectiveFrom,
        effectiveTo: p.effectiveTo,
      })),
      tax: taxes.map((t) => ({
        id: t.id,
        taxName: t.taxName,
        rateBp: t.rateBp,
        effectiveFrom: t.effectiveFrom,
        effectiveTo: t.effectiveTo,
      })),
    };
  }

  /** Ubah harga — menuntut step-up MFA (BRD 4.3, AC-38). */
  @Post('admin/pricing')
  @RequirePermissions('pricing.manage')
  @RequireStepUpMfa()
  async schedulePrice(@Body() dto: SchedulePriceDto, @CurrentUser() user: AuthenticatedUser) {
    await this.pricing.schedulePrice({
      unitPrice: BigInt(dto.unitPrice),
      effectiveFrom: dto.effectiveFrom,
      actorId: user.id,
    });
    return { message: 'Harga baru dijadwalkan.' };
  }

  /** Ubah tarif PPN — menuntut step-up MFA. */
  @Post('admin/tax')
  @RequirePermissions('pricing.manage')
  @RequireStepUpMfa()
  async scheduleTax(@Body() dto: ScheduleTaxDto, @CurrentUser() user: AuthenticatedUser) {
    await this.pricing.scheduleTax({
      rateBp: dto.rateBp,
      effectiveFrom: dto.effectiveFrom,
      actorId: user.id,
    });
    return { message: 'Tarif pajak baru dijadwalkan.' };
  }
}
