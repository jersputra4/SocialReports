import {
  EligibilityCode,
  MIN_DESCRIPTION_LENGTH,
  TAKEDOWN_ELIGIBLE_ARTICLES,
  evaluateKomdigiEligibility,
  isPlausibleTargetUrl,
  normalizeArticleNumber,
  type EligibilityCodeValue,
  type EligibilityInput,
} from './komdigi-eligibility';
import type { ReportStatusValue } from '../reports/state-machine';

const KRONOLOGI =
  'Akun tersebut menyebarkan tuduhan palsu kepada pelapor secara berulang ' +
  'sejak 12 Maret dan masih dapat diakses publik sampai hari ini.';

function baseInput(overrides: Partial<EligibilityInput> = {}): EligibilityInput {
  return {
    status: 'APPROVED',
    targetUrl: 'https://contoh.example.com/p/123456',
    description: KRONOLOGI,
    legalBasis: [
      {
        lawCode: 'UU_ITE',
        articleNumber: '27A',
        paragraphNumber: '(1)',
        linked: true,
      },
    ],
    evidences: [{ scanStatus: 'CLEAN' }],
    ...overrides,
  };
}

function codes(findings: Array<{ code: EligibilityCodeValue }>): EligibilityCodeValue[] {
  return findings.map((item) => item.code);
}

describe('gate kelayakan Komdigi', () => {
  it('meloloskan report yang lengkap', () => {
    const result = evaluateKomdigiEligibility(baseInput());

    expect(result.eligible).toBe(true);
    expect(result.blockers).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    expect(result.citedArticles).toEqual(['27A']);
    expect(result.cleanEvidenceCount).toBe(1);
  });

  it('tidak pernah melempar exception, apa pun isinya', () => {
    expect(() =>
      evaluateKomdigiEligibility({
        status: 'DRAFT',
        targetUrl: null,
        description: null,
        legalBasis: [],
        evidences: [],
      }),
    ).not.toThrow();
  });

  // ------------------------------------------------------------- status ----

  describe('status', () => {
    const ditolak: ReportStatusValue[] = [
      'DRAFT',
      'WAITING_PAYMENT',
      'PAID',
      'WAITING_REVIEW',
      'REJECTED',
      'SUBMITTED',
      'COMPLETED',
      'ARCHIVED',
    ];

    it.each(ditolak)('menolak status %s', (status) => {
      const result = evaluateKomdigiEligibility(baseInput({ status }));

      expect(result.eligible).toBe(false);
      expect(codes(result.blockers)).toContain(EligibilityCode.STATUS_NOT_APPROVED);
    });

    it('menolak report yang sudah pernah diteruskan', () => {
      const result = evaluateKomdigiEligibility(baseInput({ alreadyForwarded: true }));

      expect(result.eligible).toBe(false);
      expect(codes(result.blockers)).toContain(EligibilityCode.ALREADY_FORWARDED);
    });
  });

  // -------------------------------------------------------- dasar hukum ----

  describe('dasar hukum', () => {
    it('menolak report tanpa dasar hukum', () => {
      const result = evaluateKomdigiEligibility(baseInput({ legalBasis: [] }));

      expect(codes(result.blockers)).toContain(EligibilityCode.NO_LEGAL_BASIS);
      expect(result.citedArticles).toEqual([]);
    });

    it('menolak dasar hukum yang hanya berupa alasan bebas', () => {
      const result = evaluateKomdigiEligibility(
        baseInput({
          legalBasis: [
            {
              lawCode: null,
              articleNumber: null,
              paragraphNumber: null,
              linked: false,
              otherReason: 'Menurut saya ini melanggar hukum.',
            },
          ],
        }),
      );

      expect(codes(result.blockers)).toContain(EligibilityCode.LEGAL_BASIS_UNVERIFIED);
    });

    it('menolak dasar hukum di luar UU ITE', () => {
      const result = evaluateKomdigiEligibility(
        baseInput({
          legalBasis: [
            { lawCode: 'UU_PDP', articleNumber: '65', paragraphNumber: '(1)', linked: true },
            { lawCode: 'KUHP_PENGHINAAN', articleNumber: '433', paragraphNumber: '(1)', linked: true },
          ],
        }),
      );

      expect(codes(result.blockers)).toContain(EligibilityCode.NO_UU_ITE_BASIS);
    });

    it('menolak pasal UU ITE di luar daftar muatan yang dilarang', () => {
      const result = evaluateKomdigiEligibility(
        baseInput({
          legalBasis: [
            { lawCode: 'UU_ITE', articleNumber: '40', paragraphNumber: '(2a)', linked: true },
          ],
        }),
      );

      expect(codes(result.blockers)).toContain(
        EligibilityCode.ARTICLE_NOT_TAKEDOWN_ELIGIBLE,
      );
      expect(result.citedArticles).toEqual([]);
    });

    it('menolak pasal UU ITE yang nomornya kosong', () => {
      const result = evaluateKomdigiEligibility(
        baseInput({
          legalBasis: [
            { lawCode: 'UU_ITE', articleNumber: null, paragraphNumber: null, linked: true },
          ],
        }),
      );

      expect(codes(result.blockers)).toContain(
        EligibilityCode.ARTICLE_NOT_TAKEDOWN_ELIGIBLE,
      );
    });

    it.each([...TAKEDOWN_ELIGIBLE_ARTICLES])('menerima pasal %s', (article) => {
      const result = evaluateKomdigiEligibility(
        baseInput({
          legalBasis: [
            { lawCode: 'UU_ITE', articleNumber: article, paragraphNumber: '(1)', linked: true },
          ],
        }),
      );

      expect(result.eligible).toBe(true);
      expect(result.citedArticles).toEqual([article]);
    });

    it('mengutip pasal yang lolos dan memperingatkan sisanya', () => {
      const result = evaluateKomdigiEligibility(
        baseInput({
          legalBasis: [
            { lawCode: 'UU_ITE', articleNumber: '28', paragraphNumber: '(2)', linked: true },
            { lawCode: 'UU_ITE', articleNumber: '45', paragraphNumber: '(1)', linked: true },
          ],
        }),
      );

      expect(result.eligible).toBe(true);
      expect(result.citedArticles).toEqual(['28']);
      expect(codes(result.warnings)).toContain(EligibilityCode.UNUSED_LEGAL_BASIS);
    });

    it('memperingatkan alasan bebas yang tidak akan dicantumkan', () => {
      const result = evaluateKomdigiEligibility(
        baseInput({
          legalBasis: [
            { lawCode: 'UU_ITE', articleNumber: '29', paragraphNumber: '(1)', linked: true },
            {
              lawCode: null,
              articleNumber: null,
              paragraphNumber: null,
              linked: false,
              otherReason: 'Alasan tambahan.',
            },
          ],
        }),
      );

      expect(result.eligible).toBe(true);
      expect(result.citedArticles).toEqual(['29']);
      expect(codes(result.warnings)).toContain(EligibilityCode.UNUSED_LEGAL_BASIS);
    });

    it('tidak menduplikasi pasal yang sama dari dua ayat', () => {
      const result = evaluateKomdigiEligibility(
        baseInput({
          legalBasis: [
            { lawCode: 'UU_ITE', articleNumber: '28', paragraphNumber: '(1)', linked: true },
            { lawCode: 'UU_ITE', articleNumber: '28', paragraphNumber: '(2)', linked: true },
          ],
        }),
      );

      expect(result.citedArticles).toEqual(['28']);
    });
  });

  // ----------------------------------------------------------- URL target --

  describe('URL target', () => {
    it.each([null, '', '   '])('menolak URL kosong (%p)', (targetUrl) => {
      const result = evaluateKomdigiEligibility(baseInput({ targetUrl }));

      expect(codes(result.blockers)).toContain(EligibilityCode.NO_TARGET_URL);
    });

    it.each([
      'bukan-url',
      'ftp://contoh.example.com/berkas',
      'javascript:alert(1)',
      'https://localhost/p/1',
      'file:///etc/passwd',
    ])('menolak URL tidak layak (%s)', (targetUrl) => {
      const result = evaluateKomdigiEligibility(baseInput({ targetUrl }));

      expect(codes(result.blockers)).toContain(EligibilityCode.TARGET_URL_INVALID);
    });

    it('menerima http dan https', () => {
      for (const url of [
        'http://contoh.example.com/p/1',
        'https://contoh.example.com/p/1?ref=2',
      ]) {
        expect(evaluateKomdigiEligibility(baseInput({ targetUrl: url })).eligible).toBe(true);
      }
    });
  });

  // ---------------------------------------------------------------- bukti --

  describe('bukti', () => {
    it('menolak report tanpa bukti', () => {
      const result = evaluateKomdigiEligibility(baseInput({ evidences: [] }));

      expect(codes(result.blockers)).toContain(EligibilityCode.NO_CLEAN_EVIDENCE);
      expect(result.cleanEvidenceCount).toBe(0);
    });

    it('menolak report yang seluruh buktinya belum dipindai', () => {
      const result = evaluateKomdigiEligibility(
        baseInput({ evidences: [{ scanStatus: 'PENDING' }, { scanStatus: 'PENDING' }] }),
      );

      expect(codes(result.blockers)).toContain(EligibilityCode.NO_CLEAN_EVIDENCE);
    });

    it('menolak selama masih ada berkas terinfeksi, meski ada berkas bersih', () => {
      const result = evaluateKomdigiEligibility(
        baseInput({ evidences: [{ scanStatus: 'CLEAN' }, { scanStatus: 'INFECTED' }] }),
      );

      expect(result.eligible).toBe(false);
      expect(codes(result.blockers)).toContain(EligibilityCode.EVIDENCE_INFECTED);
      expect(codes(result.blockers)).not.toContain(EligibilityCode.NO_CLEAN_EVIDENCE);
    });

    it('meloloskan bukti bersih dan memperingatkan yang masih dipindai', () => {
      const result = evaluateKomdigiEligibility(
        baseInput({ evidences: [{ scanStatus: 'CLEAN' }, { scanStatus: 'PENDING' }] }),
      );

      expect(result.eligible).toBe(true);
      expect(result.cleanEvidenceCount).toBe(1);
      expect(codes(result.warnings)).toContain(EligibilityCode.EVIDENCE_SCAN_PENDING);
    });

    it('memperingatkan bukti yang gagal dipindai', () => {
      const result = evaluateKomdigiEligibility(
        baseInput({ evidences: [{ scanStatus: 'CLEAN' }, { scanStatus: 'ERROR' }] }),
      );

      expect(result.eligible).toBe(true);
      expect(codes(result.warnings)).toContain(EligibilityCode.EVIDENCE_SCAN_ERROR);
    });
  });

  // ------------------------------------------------------------ kronologi --

  describe('kronologi', () => {
    it.each([null, '', 'Melanggar.'])('menolak kronologi terlalu pendek (%p)', (description) => {
      const result = evaluateKomdigiEligibility(baseInput({ description }));

      expect(codes(result.blockers)).toContain(EligibilityCode.DESCRIPTION_TOO_SHORT);
    });

    it('tidak menghitung spasi kosong sebagai isi', () => {
      const result = evaluateKomdigiEligibility(
        baseInput({ description: ' '.repeat(MIN_DESCRIPTION_LENGTH + 10) }),
      );

      expect(codes(result.blockers)).toContain(EligibilityCode.DESCRIPTION_TOO_SHORT);
    });

    it('menerima kronologi tepat di ambang batas', () => {
      const result = evaluateKomdigiEligibility(
        baseInput({ description: 'a'.repeat(MIN_DESCRIPTION_LENGTH) }),
      );

      expect(result.eligible).toBe(true);
    });
  });

  // ------------------------------------------------------- akumulasi ------

  it('mengumpulkan seluruh penghalang sekaligus, tidak berhenti di yang pertama', () => {
    const result = evaluateKomdigiEligibility({
      status: 'DRAFT',
      targetUrl: null,
      description: null,
      legalBasis: [],
      evidences: [],
    });

    expect(result.eligible).toBe(false);
    expect(codes(result.blockers)).toEqual(
      expect.arrayContaining([
        EligibilityCode.STATUS_NOT_APPROVED,
        EligibilityCode.NO_LEGAL_BASIS,
        EligibilityCode.NO_TARGET_URL,
        EligibilityCode.NO_CLEAN_EVIDENCE,
        EligibilityCode.DESCRIPTION_TOO_SHORT,
      ]),
    );
  });

  it('setiap penghalang membawa pesan yang bisa dibaca admin', () => {
    const result = evaluateKomdigiEligibility({
      status: 'DRAFT',
      targetUrl: 'bukan-url',
      description: 'pendek',
      legalBasis: [],
      evidences: [{ scanStatus: 'INFECTED' }],
    });

    for (const blocker of result.blockers) {
      expect(blocker.message.length).toBeGreaterThan(10);
    }
  });
});

// ---------------------------------------------------------------- utilitas --

describe('normalizeArticleNumber', () => {
  it.each([
    ['27A', '27A'],
    ['27a', '27A'],
    ['Pasal 27A', '27A'],
    ['pasal 27 a', '27A'],
    [' 28 ', '28'],
    ['Pasal 28.', '28'],
  ])('menyeragamkan %p menjadi %p', (input, expected) => {
    expect(normalizeArticleNumber(input)).toBe(expected);
  });

  it.each([null, '', '   ', 'Pasal'])('mengembalikan null untuk %p', (input) => {
    expect(normalizeArticleNumber(input)).toBeNull();
  });
});

describe('isPlausibleTargetUrl', () => {
  it.each([
    'https://contoh.example.com/p/1',
    'http://contoh.example.com',
    'https://sub.domain.example.co.id/a/b?c=d#e',
  ])('menerima %s', (url) => {
    expect(isPlausibleTargetUrl(url)).toBe(true);
  });

  it.each([
    'bukan-url',
    'ftp://contoh.example.com',
    'javascript:alert(1)',
    'https://localhost',
    'https://.example.com',
    '',
  ])('menolak %p', (url) => {
    expect(isPlausibleTargetUrl(url)).toBe(false);
  });
});
