/**
 * Perhitungan uang — BRD/SRS v1.1 §6.1.
 *
 *   subtotal     = package_quantity x unit_price
 *   tax_amount   = pembulatan_half_up( subtotal x rate_bp / 10000 )
 *   total_amount = subtotal + tax_amount
 *
 * Seluruh perhitungan memakai BigInt dalam rupiah penuh. Tidak ada float,
 * sehingga tidak ada galat pembulatan biner.
 */

export interface PriceBreakdown {
  unitPrice: bigint;
  quantity: number;
  subtotal: bigint;
  taxRateBp: number;
  taxAmount: bigint;
  totalAmount: bigint;
}

/**
 * Pembulatan half-up ke rupiah terdekat untuk pembagian bilangan bulat positif.
 * Dilakukan dengan menambahkan separuh pembagi sebelum membagi, sehingga
 * tidak pernah menyentuh aritmetika pecahan.
 */
export function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new Error('Pembagi harus lebih besar dari nol');
  }
  if (numerator >= 0n) {
    return (numerator * 2n + denominator) / (denominator * 2n);
  }
  return -((-numerator * 2n + denominator) / (denominator * 2n));
}

export function calculatePrice(
  unitPrice: bigint,
  quantity: number,
  taxRateBp: number,
): PriceBreakdown {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error('Jumlah unit harus bilangan bulat positif');
  }
  if (!Number.isInteger(taxRateBp) || taxRateBp < 0 || taxRateBp > 10_000) {
    throw new Error('Tarif pajak harus 0..10000 basis poin');
  }
  if (unitPrice <= 0n) {
    throw new Error('Harga satuan harus lebih besar dari nol');
  }

  const subtotal = unitPrice * BigInt(quantity);
  const taxAmount = divideRoundHalfUp(subtotal * BigInt(taxRateBp), 10_000n);

  return {
    unitPrice,
    quantity,
    subtotal,
    taxRateBp,
    taxAmount,
    totalAmount: subtotal + taxAmount,
  };
}

/** Rp1.234.567 */
export function formatRupiah(amount: bigint | number): string {
  const value = typeof amount === 'bigint' ? amount : BigInt(Math.round(amount));
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString();
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += '.';
    out += digits[i];
  }
  return `${negative ? '-' : ''}Rp${out}`;
}

/** 1100 -> "11%" ; 1050 -> "10,5%" */
export function formatTaxRate(rateBp: number): string {
  const percent = rateBp / 100;
  return `${percent.toString().replace('.', ',')}%`;
}
