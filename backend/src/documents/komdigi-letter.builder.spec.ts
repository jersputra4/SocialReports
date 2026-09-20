import {
  buildKomdigiLetter,
  flattenLetterText,
  formatArticleReference,
  type KomdigiLetterData,
} from './komdigi-letter.builder';

const KRONOLOGI =
  'Akun tersebut memuat tuduhan yang ditujukan kepada pelapor dan masih dapat ' +
  'diakses publik sampai surat ini dibuat.';

function letterData(overrides: Partial<KomdigiLetterData> = {}): KomdigiLetterData {
  return {
    letterNumber: '007/SRS-KOMDIGI/IX/2026',
    letterDate: new Date('2026-09-20T03:00:00Z'),
    reportCode: 'RPT-ABCDEF1234',
    sender: {
      organizationName: 'PT Contoh Pelaporan Digital',
      address: 'Jalan Contoh 1, Jakarta',
      email: 'aduan@contoh.example.com',
      phone: '+62 21 0000 0000',
    },
    reporter: {
      fullName: 'Siti Rahayu',
      email: 'siti@contoh.example.com',
    },
    target: {
      url: 'https://contoh.example.com/p/123456',
      canonicalUrl: 'https://contoh.example.com/p/123456',
      platformName: 'Contoh Sosial',
      actionTypeName: 'Pelaporan Postingan',
    },
    legalBasis: [
      {
        lawName: 'Undang-Undang tentang Informasi dan Transaksi Elektronik',
        lawVersion: 'UU 11/2008 jo. UU 19/2016 jo. UU 1/2024',
        articleNumber: '27A',
        paragraphNumber: '(1)',
        text: 'Setiap Orang dengan sengaja menyerang kehormatan atau nama baik orang lain.',
      },
    ],
    chronology: KRONOLOGI,
    evidences: [
      {
        fileName: 'tangkapan-layar-1.png',
        fileHash: 'a'.repeat(64),
        fileSize: 204800,
        caption: 'Tangkapan layar unggahan',
        createdAt: new Date('2026-09-18T02:00:00Z'),
      },
    ],
    generatedAt: new Date('2026-09-20T03:05:00Z'),
    ...overrides,
  };
}

function letterText(data: KomdigiLetterData): string {
  return flattenLetterText(buildKomdigiLetter(data).content);
}

describe('surat aduan Komdigi', () => {
  it('memuat nomor surat, kode report, dan identitas pelapor', () => {
    const body = letterText(letterData());

    expect(body).toContain('007/SRS-KOMDIGI/IX/2026');
    expect(body).toContain('RPT-ABCDEF1234');
    expect(body).toContain('Siti Rahayu');
    expect(body).toContain('siti@contoh.example.com');
  });

  it('memuat identitas pengirim dan tujuan surat', () => {
    const body = letterText(letterData());

    expect(body).toContain('PT Contoh Pelaporan Digital');
    expect(body).toContain('Kementerian Komunikasi dan Digital Republik Indonesia');
  });

  it('memuat tautan dan platform objek yang diadukan', () => {
    const body = letterText(letterData());

    expect(body).toContain('https://contoh.example.com/p/123456');
    expect(body).toContain('Contoh Sosial');
  });

  it('mengutip setiap pasal beserta bunyinya', () => {
    const body = letterText(
      letterData({
        legalBasis: [
          {
            lawName: 'UU ITE',
            lawVersion: null,
            articleNumber: '27A',
            paragraphNumber: '(1)',
            text: 'Bunyi pasal dua puluh tujuh A.',
          },
          {
            lawName: 'UU ITE',
            lawVersion: null,
            articleNumber: '28',
            paragraphNumber: '(2)',
            text: 'Bunyi pasal dua puluh delapan.',
          },
        ],
      }),
    );

    expect(body).toContain('Pasal 27A ayat (1)');
    expect(body).toContain('Pasal 28 ayat (2)');
    expect(body).toContain('Bunyi pasal dua puluh tujuh A.');
    expect(body).toContain('Bunyi pasal dua puluh delapan.');
  });

  it('memuat kronologi dari pelapor', () => {
    expect(letterText(letterData())).toContain('masih dapat diakses publik');
  });

  it('mencantumkan nama berkas dan SHA-256 tiap bukti', () => {
    const body = letterText(
      letterData({
        evidences: [
          {
            fileName: 'bukti-satu.png',
            fileHash: 'b'.repeat(64),
            fileSize: 1024,
            caption: null,
            createdAt: new Date('2026-09-18T02:00:00Z'),
          },
          {
            fileName: 'bukti-dua.pdf',
            fileHash: 'c'.repeat(64),
            fileSize: 5 * 1024 * 1024,
            caption: 'Salinan percakapan',
            createdAt: new Date('2026-09-19T02:00:00Z'),
          },
        ],
      }),
    );

    expect(body).toContain('bukti-satu.png');
    expect(body).toContain('bukti-dua.pdf');
    expect(body).toContain('b'.repeat(64));
    expect(body).toContain('c'.repeat(64));
    expect(body).toContain('Salinan percakapan');
    expect(body).toContain('1.0 KB');
    expect(body).toContain('5.0 MB');
  });

  it('menyebut jumlah lampiran sesuai jumlah bukti', () => {
    const body = letterText(
      letterData({
        evidences: [
          {
            fileName: 'a.png',
            fileHash: 'd'.repeat(64),
            fileSize: 100,
            caption: null,
            createdAt: new Date('2026-09-18T02:00:00Z'),
          },
          {
            fileName: 'b.png',
            fileHash: 'e'.repeat(64),
            fileSize: 100,
            caption: null,
            createdAt: new Date('2026-09-18T02:00:00Z'),
          },
        ],
      }),
    );

    expect(body).toContain('2 berkas bukti');
  });

  // --------------------------------------------------------------- bahasa --

  describe('bahasa surat', () => {
    it('menyatakan dugaan, bukan pelanggaran yang sudah pasti', () => {
      const body = letterText(letterData());

      expect(body).toContain('diduga melanggar');
      expect(body).toMatch(/kewenangan/i);
    });

    it('tidak memerintahkan pemutusan akses', () => {
      const body = letterText(letterData()).toLowerCase();

      for (const larangan of [
        'wajib menurunkan',
        'harus menurunkan',
        'wajib memblokir',
        'harus memblokir',
        'segera blokir',
        'kami perintahkan',
      ]) {
        expect(body).not.toContain(larangan);
      }
    });
  });

  // ------------------------------------------------------------ ketahanan --

  describe('ketahanan masukan', () => {
    it('membersihkan karakter kendali dan pembalik arah dari teks bebas', () => {
      const body = letterText(
        letterData({ chronology: 'Awal\u0000tengah‮akhir', reporter: { fullName: 'Nama\u0001Uji', email: 'a@b.com' } }),
      );

      expect(body).not.toContain('\u0000');
      expect(body).not.toContain('‮');
      expect(body).not.toContain('\u0001');
      expect(body).toContain('Awaltengahakhir');
    });

    it('tetap menghasilkan surat ketika dasar hukum kosong', () => {
      const body = letterText(letterData({ legalBasis: [] }));

      expect(body).toContain('Tidak ada dasar hukum yang tercantum.');
    });

    it('tetap menghasilkan surat ketika bukti kosong', () => {
      const body = letterText(letterData({ evidences: [] }));

      expect(body).toContain('Tidak ada bukti terlampir.');
      expect(body).toContain('0 berkas bukti');
    });

    it('mengganti nilai kosong dengan tanda pisah, bukan string kosong', () => {
      const body = letterText(
        letterData({
          target: {
            url: 'https://contoh.example.com/p/1',
            canonicalUrl: null,
            platformName: null,
            actionTypeName: null,
          },
        }),
      );

      expect(body).toContain('—');
    });
  });

  it('menyusun metadata dokumen dengan kode report', () => {
    const doc = buildKomdigiLetter(letterData());

    expect(doc.info?.title).toContain('RPT-ABCDEF1234');
    expect(doc.info?.author).toBe('PT Contoh Pelaporan Digital');
    expect(doc.pageSize).toBe('A4');
  });
});

describe('formatArticleReference', () => {
  it.each([
    [{ articleNumber: '27A', paragraphNumber: '(1)' }, 'Pasal 27A ayat (1)'],
    [{ articleNumber: '28', paragraphNumber: null }, 'Pasal 28'],
    [{ articleNumber: ' 29 ', paragraphNumber: ' (1) ' }, 'Pasal 29 ayat (1)'],
    [{ articleNumber: null, paragraphNumber: null }, 'Pasal tidak tercantum'],
  ])('menyusun %p menjadi %p', (basis, expected) => {
    expect(formatArticleReference(basis)).toBe(expected);
  });
});

describe('flattenLetterText', () => {
  it('menelusuri stack, columns, dan tabel bersarang', () => {
    const node = {
      stack: [
        { text: 'satu' },
        { columns: [{ text: 'dua' }, { stack: [{ text: 'tiga' }] }] },
        { table: { body: [[{ text: 'empat' }]] } },
      ],
    };

    const flat = flattenLetterText(node);

    for (const expected of ['satu', 'dua', 'tiga', 'empat']) {
      expect(flat).toContain(expected);
    }
  });

  it('mengabaikan nilai kosong tanpa melempar exception', () => {
    expect(() => flattenLetterText(null)).not.toThrow();
    expect(flattenLetterText(undefined)).toBe('');
    expect(flattenLetterText(42)).toBe('42');
  });
});
