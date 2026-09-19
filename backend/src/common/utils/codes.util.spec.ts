import {
  formatGatewayOrderId,
  formatInvoiceNumber,
  generateReportCode,
  isValidReportCode,
} from './codes.util';

describe('kode report publik (BRD 4.5, AC-08)', () => {
  it('selalu berformat RPT-XXXXXXXXXX', () => {
    for (let i = 0; i < 500; i += 1) {
      expect(generateReportCode()).toMatch(/^RPT-[0-9A-HJKMNP-TV-Z]{10}$/);
    }
  });

  it('tidak memakai huruf yang mudah tertukar (I, L, O, U)', () => {
    for (let i = 0; i < 500; i += 1) {
      expect(generateReportCode()).not.toMatch(/[ILOU]/);
    }
  });

  it('tidak berurutan — 2000 kode berturut-turut tidak menunjukkan pola naik', () => {
    const codes = Array.from({ length: 2000 }, () => generateReportCode());
    const unique = new Set(codes);
    expect(unique.size).toBe(codes.length);

    let ascending = 0;
    for (let i = 1; i < codes.length; i += 1) {
      if (codes[i] > codes[i - 1]) ascending += 1;
    }
    // Pada urutan acak proporsinya mendekati 0,5. Generator berurutan akan ~1,0.
    const ratio = ascending / (codes.length - 1);
    expect(ratio).toBeGreaterThan(0.4);
    expect(ratio).toBeLessThan(0.6);
  });

  it('memvalidasi karakter cek', () => {
    const code = generateReportCode();
    expect(isValidReportCode(code)).toBe(true);

    // Mengganti satu karakter badan membuat karakter cek tidak cocok.
    const tampered = `${code.slice(0, 4)}${code[4] === '0' ? '1' : '0'}${code.slice(5)}`;
    expect(isValidReportCode(tampered)).toBe(false);
  });

  it('menolak format yang salah', () => {
    expect(isValidReportCode('RPT-000001')).toBe(false);
    expect(isValidReportCode('rpt-a1b2c3d4e5')).toBe(false);
    expect(isValidReportCode('RPT-IIIIIIIIII')).toBe(false);
    expect(isValidReportCode('')).toBe(false);
  });
});

describe('penomoran dokumen', () => {
  it('nomor invoice berurutan dengan padding', () => {
    expect(formatInvoiceNumber(2026, 1)).toBe('INV/2026/000001');
    expect(formatInvoiceNumber(2026, 123456)).toBe('INV/2026/123456');
  });

  it('id order gateway menyertakan kode report dan percobaan', () => {
    expect(formatGatewayOrderId('RPT-A1B2C3D4E5', 1)).toBe('RPT-A1B2C3D4E5-01');
    expect(formatGatewayOrderId('RPT-A1B2C3D4E5', 12)).toBe('RPT-A1B2C3D4E5-12');
  });
});
