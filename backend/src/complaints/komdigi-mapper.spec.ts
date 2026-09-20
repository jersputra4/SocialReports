import { evaluateKomdigiEligibility } from './komdigi-eligibility';
import {
  ROMAN_MONTHS,
  attachableEvidences,
  formatKomdigiLetterNumber,
  lawCodeOf,
  resolveTargetUrl,
  toEligibilityInput,
  toLetterData,
  type EvidenceRow,
  type LegalBasisRow,
  type ReportRow,
  type SenderIdentity,
} from './komdigi-mapper';

const SENDER: SenderIdentity = {
  organizationName: 'PT Contoh Pelaporan Digital',
  address: 'Jalan Contoh 1, Jakarta',
  email: 'aduan@contoh.example.com',
  phone: '+62 21 0000 0000',
};

function legalBasis(overrides: Partial<LegalBasisRow> = {}): LegalBasisRow {
  return {
    paragraphId: 'par-1',
    lawNameSnapshot: 'Undang-Undang tentang Informasi dan Transaksi Elektronik',
    lawVersionSnapshot: 'UU 1/2024',
    articleNumberSnapshot: '27A',
    paragraphNumberSnapshot: '(1)',
    textSnapshot: 'Bunyi pasal.',
    otherReason: null,
    paragraph: { article: { legalVersion: { law: { code: 'UU_ITE' } } } },
    ...overrides,
  };
}

function evidence(overrides: Partial<EvidenceRow> = {}): EvidenceRow {
  return {
    fileName: 'bukti.png',
    fileHash: 'a'.repeat(64),
    fileSize: 1024,
    caption: null,
    createdAt: new Date('2026-09-18T02:00:00Z'),
    scanStatus: 'CLEAN',
    storagePath: 'evidence/1',
    fileType: 'image/png',
    ...overrides,
  };
}

function reportRow(overrides: Partial<ReportRow> = {}): ReportRow {
  return {
    reportCode: 'RPT-ABCDEF1234',
    status: 'APPROVED',
    description:
      'Akun tersebut menyebarkan tuduhan palsu kepada pelapor dan masih dapat diakses publik.',
    user: { fullName: 'Siti Rahayu', email: 'siti@contoh.example.com' },
    actionType: { name: 'Pelaporan Postingan' },
    platformNameSnapshot: 'Contoh Sosial',
    targetSnapshot: {
      originalUrl: 'https://contoh.example.com/p/1?utm=abc',
      canonicalUrl: 'https://contoh.example.com/p/1',
    },
    legalBasis: [legalBasis()],
    evidences: [evidence()],
    ...overrides,
  };
}

// ------------------------------------------------------------ nomor surat --

describe('formatKomdigiLetterNumber', () => {
  it('menyusun nomor dengan bulan romawi dan percobaan berpadding', () => {
    expect(
      formatKomdigiLetterNumber({
        reportCode: 'RPT-ABCDEF1234',
        attempt: 1,
        date: new Date('2026-09-20T03:00:00Z'),
      }),
    ).toBe('001/RPT-ABCDEF1234/KOMDIGI/IX/2026');
  });

  it('menaikkan nomor percobaan', () => {
    expect(
      formatKomdigiLetterNumber({
        reportCode: 'RPT-A',
        attempt: 12,
        date: new Date('2026-09-20T03:00:00Z'),
      }),
    ).toBe('012/RPT-A/KOMDIGI/IX/2026');
  });

  it('memperlakukan percobaan nol dan negatif sebagai percobaan pertama', () => {
    for (const attempt of [0, -3]) {
      expect(
        formatKomdigiLetterNumber({
          reportCode: 'RPT-A',
          attempt,
          date: new Date('2026-09-20T03:00:00Z'),
        }),
      ).toContain('001/');
    }
  });

  it('memakai zona waktu Jakarta, bukan UTC', () => {
    // 31 Desember 2026 pukul 20:00 UTC adalah 1 Januari 2027 di Jakarta.
    const nomor = formatKomdigiLetterNumber({
      reportCode: 'RPT-A',
      attempt: 1,
      date: new Date('2026-12-31T20:00:00Z'),
    });

    expect(nomor).toContain('/I/2027');
  });

  it('memuat dua belas bulan romawi', () => {
    expect(ROMAN_MONTHS).toHaveLength(12);
    expect(ROMAN_MONTHS[0]).toBe('I');
    expect(ROMAN_MONTHS[11]).toBe('XII');
  });
});

// ---------------------------------------------------------------- dasar ----

describe('lawCodeOf', () => {
  it('membaca kode hukum dari rantai relasi', () => {
    expect(lawCodeOf(legalBasis())).toBe('UU_ITE');
  });

  it('mengembalikan null untuk dasar hukum bebas', () => {
    expect(lawCodeOf(legalBasis({ paragraphId: null, paragraph: null }))).toBeNull();
  });
});

describe('resolveTargetUrl', () => {
  it('mendahulukan URL kanonik', () => {
    expect(resolveTargetUrl(reportRow())).toBe('https://contoh.example.com/p/1');
  });

  it('jatuh ke URL asli ketika kanonik kosong', () => {
    const row = reportRow({
      targetSnapshot: { originalUrl: 'https://contoh.example.com/p/2', canonicalUrl: null },
    });

    expect(resolveTargetUrl(row)).toBe('https://contoh.example.com/p/2');
  });

  it('mengembalikan null ketika snapshot target tidak ada', () => {
    expect(resolveTargetUrl(reportRow({ targetSnapshot: null }))).toBeNull();
  });
});

// ------------------------------------------------------- input kelayakan ---

describe('toEligibilityInput', () => {
  it('menghasilkan masukan yang lolos gate untuk report lengkap', () => {
    const hasil = evaluateKomdigiEligibility(toEligibilityInput(reportRow()));

    expect(hasil.eligible).toBe(true);
    expect(hasil.citedArticles).toEqual(['27A']);
  });

  it('menandai dasar hukum bebas sebagai tidak tertaut', () => {
    const input = toEligibilityInput(
      reportRow({
        legalBasis: [legalBasis({ paragraphId: null, paragraph: null, otherReason: 'Alasan.' })],
      }),
    );

    expect(input.legalBasis[0].linked).toBe(false);
    expect(input.legalBasis[0].lawCode).toBeNull();
    expect(evaluateKomdigiEligibility(input).eligible).toBe(false);
  });

  it('meneruskan penanda sudah pernah diteruskan', () => {
    const input = toEligibilityInput(reportRow(), true);

    expect(input.alreadyForwarded).toBe(true);
    expect(evaluateKomdigiEligibility(input).eligible).toBe(false);
  });

  it('meneruskan status pemindaian tiap bukti apa adanya', () => {
    const input = toEligibilityInput(
      reportRow({ evidences: [evidence({ scanStatus: 'INFECTED' })] }),
    );

    expect(input.evidences[0].scanStatus).toBe('INFECTED');
  });
});

describe('attachableEvidences', () => {
  it('hanya mengambil bukti yang lolos pemindaian', () => {
    const row = reportRow({
      evidences: [
        evidence({ fileName: 'bersih.png', scanStatus: 'CLEAN' }),
        evidence({ fileName: 'menunggu.png', scanStatus: 'PENDING' }),
        evidence({ fileName: 'terinfeksi.png', scanStatus: 'INFECTED' }),
      ],
    });

    expect(attachableEvidences(row).map((item) => item.fileName)).toEqual(['bersih.png']);
  });
});

// --------------------------------------------------------------- surat -----

describe('toLetterData', () => {
  function letterFor(row: ReportRow, cited: string[] = ['27A']) {
    return toLetterData({
      report: row,
      sender: SENDER,
      letterNumber: '001/RPT-ABCDEF1234/KOMDIGI/IX/2026',
      letterDate: new Date('2026-09-20T03:00:00Z'),
      citedArticles: cited,
      generatedAt: new Date('2026-09-20T03:05:00Z'),
    });
  }

  it('memindahkan identitas pelapor dan pengirim', () => {
    const surat = letterFor(reportRow());

    expect(surat.reporter.fullName).toBe('Siti Rahayu');
    expect(surat.sender.organizationName).toBe('PT Contoh Pelaporan Digital');
    expect(surat.reportCode).toBe('RPT-ABCDEF1234');
  });

  it('memakai URL kanonik sebagai tautan utama', () => {
    expect(letterFor(reportRow()).target.url).toBe('https://contoh.example.com/p/1');
  });

  it('hanya mengutip pasal yang lolos gate', () => {
    const row = reportRow({
      legalBasis: [
        legalBasis({ articleNumberSnapshot: '27A' }),
        legalBasis({ articleNumberSnapshot: '45', paragraphId: 'par-2' }),
      ],
    });

    const surat = letterFor(row, ['27A']);

    expect(surat.legalBasis).toHaveLength(1);
    expect(surat.legalBasis[0].articleNumber).toBe('27A');
  });

  it('tidak mengutip dasar hukum bebas meski pasalnya cocok', () => {
    const row = reportRow({
      legalBasis: [legalBasis({ paragraphId: null, paragraph: null })],
    });

    expect(letterFor(row).legalBasis).toHaveLength(0);
  });

  it('mencocokkan nomor pasal tanpa peduli spasi dan huruf besar-kecil', () => {
    const row = reportRow({
      legalBasis: [legalBasis({ articleNumberSnapshot: ' 27a ' })],
    });

    expect(letterFor(row, ['27A']).legalBasis).toHaveLength(1);
  });

  it('hanya melampirkan bukti yang lolos pemindaian', () => {
    const row = reportRow({
      evidences: [
        evidence({ fileName: 'bersih.png', scanStatus: 'CLEAN' }),
        evidence({ fileName: 'menunggu.png', scanStatus: 'PENDING' }),
      ],
    });

    expect(letterFor(row).evidences.map((item) => item.fileName)).toEqual(['bersih.png']);
  });

  it('mengganti kronologi kosong dengan string kosong, bukan null', () => {
    expect(letterFor(reportRow({ description: null })).chronology).toBe('');
  });

  it('mengganti URL kosong dengan string kosong, bukan null', () => {
    expect(letterFor(reportRow({ targetSnapshot: null })).target.url).toBe('');
  });
});
