import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AuditAction } from '../common/audit/audit-actions';
import { PriceBreakdown, calculatePrice } from '../common/utils/money.util';

export interface EffectivePricing {
  unitPrice: bigint;
  taxName: string;
  taxRateBp: number;
  pricingId: string;
  taxId: string;
}

/**
 * Harga dan pajak — BRD/SRS v1.1 §6.
 *
 * Nilai yang berlaku selalu diambil dari `pricing_config` dan `tax_config`
 * berdasarkan tanggal, tidak pernah dari konstanta di kode atau dari frontend.
 * Perubahan tarif cukup dilakukan lewat data, tanpa rilis ulang (R-09).
 */
@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async effectiveAt(at: Date = new Date(), tx?: Prisma.TransactionClient): Promise<EffectivePricing> {
    const client = tx ?? this.prisma;

    const [pricing, tax] = await Promise.all([
      client.pricingConfig.findFirst({
        where: {
          effectiveFrom: { lte: at },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
        },
        orderBy: { effectiveFrom: 'desc' },
      }),
      client.taxConfig.findFirst({
        where: {
          taxName: 'PPN',
          effectiveFrom: { lte: at },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
        },
        orderBy: { effectiveFrom: 'desc' },
      }),
    ]);

    if (!pricing) {
      throw new NotFoundException(
        'Konfigurasi harga belum tersedia. Hubungi administrator.',
      );
    }
    if (!tax) {
      throw new NotFoundException(
        'Konfigurasi pajak belum tersedia. Hubungi administrator.',
      );
    }

    return {
      unitPrice: pricing.unitPrice,
      taxName: tax.taxName,
      taxRateBp: tax.rateBp,
      pricingId: pricing.id,
      taxId: tax.id,
    };
  }

  /** Rincian harga untuk satu paket pada waktu tertentu. */
  async quote(quantity: number, at: Date = new Date()): Promise<PriceBreakdown & { taxName: string }> {
    const effective = await this.effectiveAt(at);
    return {
      ...calculatePrice(effective.unitPrice, quantity, effective.taxRateBp),
      taxName: effective.taxName,
    };
  }

  /** Daftar paket aktif lengkap dengan rincian harga — dipakai halaman pilih paket. */
  async catalogue(): Promise<
    Array<{
      packageId: string;
      code: string;
      quantity: number;
      unitPrice: string;
      subtotal: string;
      taxName: string;
      taxRateBp: number;
      taxAmount: string;
      totalAmount: string;
    }>
  > {
    const [packages, effective] = await Promise.all([
      this.prisma.package.findMany({ where: { active: true }, orderBy: { quantity: 'asc' } }),
      this.effectiveAt(),
    ]);

    return packages.map((pkg) => {
      const price = calculatePrice(effective.unitPrice, pkg.quantity, effective.taxRateBp);
      return {
        packageId: pkg.id,
        code: pkg.code,
        quantity: pkg.quantity,
        unitPrice: price.unitPrice.toString(),
        subtotal: price.subtotal.toString(),
        taxName: effective.taxName,
        taxRateBp: price.taxRateBp,
        taxAmount: price.taxAmount.toString(),
        totalAmount: price.totalAmount.toString(),
      };
    });
  }

  // ------------------------------------------------------------ pengelolaan --

  async listPricingHistory() {
    return this.prisma.pricingConfig.findMany({ orderBy: { effectiveFrom: 'desc' }, take: 50 });
  }

  async listTaxHistory() {
    return this.prisma.taxConfig.findMany({ orderBy: { effectiveFrom: 'desc' }, take: 50 });
  }

  /**
   * Menjadwalkan harga baru.
   *
   * Rentang lama ditutup pada saat rentang baru mulai. Constraint exclusion di
   * database menolak rentang yang tumpang tindih, sehingga selalu ada tepat
   * satu harga yang berlaku pada satu waktu.
   */
  async schedulePrice(input: {
    unitPrice: bigint;
    effectiveFrom: Date;
    actorId: string;
  }): Promise<void> {
    if (input.unitPrice <= 0n) {
      throw new BadRequestException('Harga satuan harus lebih besar dari nol.');
    }
    if (input.effectiveFrom.getTime() < Date.now() - 60_000) {
      throw new BadRequestException(
        'Harga baru tidak dapat berlaku surut. Report yang sudah dibuat memakai snapshot harganya sendiri.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const current = await tx.pricingConfig.findFirst({
        where: { effectiveTo: null },
        orderBy: { effectiveFrom: 'desc' },
      });

      if (current) {
        await tx.pricingConfig.update({
          where: { id: current.id },
          data: { effectiveTo: input.effectiveFrom },
        });
      }

      const created = await tx.pricingConfig.create({
        data: {
          unitPrice: input.unitPrice,
          effectiveFrom: input.effectiveFrom,
          createdBy: input.actorId,
        },
      });

      await this.audit.record(
        {
          action: AuditAction.PRICE_CONFIG_CHANGE,
          entityType: 'pricing_config',
          entityId: created.id,
          before: current ? { unitPrice: current.unitPrice.toString() } : undefined,
          after: {
            unitPrice: input.unitPrice.toString(),
            effectiveFrom: input.effectiveFrom.toISOString(),
          },
        },
        tx,
      );
    });
  }

  async scheduleTax(input: {
    rateBp: number;
    effectiveFrom: Date;
    actorId: string;
  }): Promise<void> {
    if (!Number.isInteger(input.rateBp) || input.rateBp < 0 || input.rateBp > 10_000) {
      throw new BadRequestException('Tarif pajak harus 0 sampai 10000 basis poin.');
    }
    if (input.effectiveFrom.getTime() < Date.now() - 60_000) {
      throw new BadRequestException('Tarif pajak baru tidak dapat berlaku surut.');
    }

    await this.prisma.$transaction(async (tx) => {
      const current = await tx.taxConfig.findFirst({
        where: { taxName: 'PPN', effectiveTo: null },
        orderBy: { effectiveFrom: 'desc' },
      });

      if (current) {
        await tx.taxConfig.update({
          where: { id: current.id },
          data: { effectiveTo: input.effectiveFrom },
        });
      }

      const created = await tx.taxConfig.create({
        data: {
          taxName: 'PPN',
          rateBp: input.rateBp,
          effectiveFrom: input.effectiveFrom,
          createdBy: input.actorId,
        },
      });

      await this.audit.record(
        {
          action: AuditAction.TAX_CONFIG_CHANGE,
          entityType: 'tax_config',
          entityId: created.id,
          before: current ? { rateBp: current.rateBp } : undefined,
          after: { rateBp: input.rateBp, effectiveFrom: input.effectiveFrom.toISOString() },
        },
        tx,
      );
    });
  }
}
