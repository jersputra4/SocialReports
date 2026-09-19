import { calculatePrice, divideRoundHalfUp, formatRupiah, formatTaxRate } from './money.util';

describe('perhitungan harga dan PPN (BRD 6.1, AC-11)', () => {
  const UNIT = 1000n;
  const PPN = 1100; // 11,00% dalam basis poin

  it('menghasilkan total sesuai tabel 6.2 dokumen', () => {
    const expected = [
      { qty: 300, subtotal: 300_000n, tax: 33_000n, total: 333_000n },
      { qty: 500, subtotal: 500_000n, tax: 55_000n, total: 555_000n },
      { qty: 1000, subtotal: 1_000_000n, tax: 110_000n, total: 1_110_000n },
      { qty: 1500, subtotal: 1_500_000n, tax: 165_000n, total: 1_665_000n },
    ];

    for (const row of expected) {
      const result = calculatePrice(UNIT, row.qty, PPN);
      expect(result.subtotal).toBe(row.subtotal);
      expect(result.taxAmount).toBe(row.tax);
      expect(result.totalAmount).toBe(row.total);
    }
  });

  it('total selalu sama dengan subtotal ditambah pajak', () => {
    for (const qty of [1, 7, 33, 300, 501, 999, 1500, 99991]) {
      const r = calculatePrice(UNIT, qty, PPN);
      expect(r.totalAmount).toBe(r.subtotal + r.taxAmount);
    }
  });

  it('membulatkan setengah ke atas ke rupiah terdekat', () => {
    // 5 x 1 rupiah dengan tarif 11% = 0,55 -> 1
    expect(calculatePrice(1n, 5, 1100).taxAmount).toBe(1n);
    // 4 x 1 rupiah dengan tarif 11% = 0,44 -> 0
    expect(calculatePrice(1n, 4, 1100).taxAmount).toBe(0n);
    // tepat 0,5 dibulatkan ke atas
    expect(divideRoundHalfUp(5n, 10n)).toBe(1n);
    expect(divideRoundHalfUp(4n, 10n)).toBe(0n);
    expect(divideRoundHalfUp(15n, 10n)).toBe(2n);
  });

  it('tidak memakai bilangan pecahan sehingga bebas galat floating point', () => {
    // 0.1 + 0.2 !== 0.3 pada float; di sini seluruhnya bilangan bulat.
    const r = calculatePrice(333_333_333n, 3, 1100);
    expect(r.subtotal).toBe(999_999_999n);
    expect(r.taxAmount).toBe(110_000_000n);
    expect(r.totalAmount).toBe(1_109_999_999n);
  });

  it('menolak parameter yang tidak masuk akal', () => {
    expect(() => calculatePrice(UNIT, 0, PPN)).toThrow();
    expect(() => calculatePrice(UNIT, -5, PPN)).toThrow();
    expect(() => calculatePrice(UNIT, 1.5, PPN)).toThrow();
    expect(() => calculatePrice(0n, 300, PPN)).toThrow();
    expect(() => calculatePrice(UNIT, 300, -1)).toThrow();
    expect(() => calculatePrice(UNIT, 300, 20_000)).toThrow();
  });

  it('tarif nol menghasilkan pajak nol', () => {
    const r = calculatePrice(UNIT, 300, 0);
    expect(r.taxAmount).toBe(0n);
    expect(r.totalAmount).toBe(300_000n);
  });
});

describe('format tampilan', () => {
  it('menulis rupiah dengan pemisah ribuan', () => {
    expect(formatRupiah(0n)).toBe('Rp0');
    expect(formatRupiah(1000n)).toBe('Rp1.000');
    expect(formatRupiah(333_000n)).toBe('Rp333.000');
    expect(formatRupiah(1_665_000n)).toBe('Rp1.665.000');
    expect(formatRupiah(-1_500n)).toBe('-Rp1.500');
  });

  it('menulis tarif pajak dengan koma desimal', () => {
    expect(formatTaxRate(1100)).toBe('11%');
    expect(formatTaxRate(1050)).toBe('10,5%');
    expect(formatTaxRate(0)).toBe('0%');
  });
});
