import {
  DEFAULT_EXCERPT_LENGTH,
  MAX_EXCERPT_LENGTH,
  MAX_PARAMETER_LENGTH,
  buildAdminNotification,
  buildExcerpt,
  flattenWhitespace,
  formatJakartaTime,
  formatPackage,
  maskDestination,
  summarizeGrounds,
  truncateAtWord,
  type AdminNotificationInput,
} from './admin-notification';

const OCCURRED_AT = new Date('2026-09-20T07:31:00.000Z'); // 14:31 WIB

function input(overrides: Partial<AdminNotificationInput> = {}): AdminNotificationInput {
  return {
    reportCode: 'RPT-R2QGGWHNM7',
    status: 'WAITING_REVIEW',
    targetUrl: 'https://example.com/p/abc123',
    platformName: 'Instagram',
    actionTypeName: 'Takedown konten',
    policyLabels: ['Ujaran kebencian'],
    articleLabels: ['UU ITE Pasal 28 ayat (2)'],
    description: 'Akun tersebut mengunggah konten yang menyerang kelompok tertentu.',
    packageQuantity: 500,
    evidenceCount: 2,
    adminLink: 'http://145.79.8.242:8080/admin/report/RPT-R2QGGWHNM7',
    occurredAt: OCCURRED_AT,
    ...overrides,
  };
}

describe('flattenWhitespace', () => {
  it('mengganti baris baru dengan satu spasi', () => {
    expect(flattenWhitespace('baris satu\nbaris dua')).toBe('baris satu baris dua');
  });

  it('meruntuhkan spasi beruntun dan tab', () => {
    expect(flattenWhitespace('a \t\t  b')).toBe('a b');
  });

  it('memangkas spasi di kedua ujung', () => {
    expect(flattenWhitespace('  teks  ')).toBe('teks');
  });
});

describe('truncateAtWord', () => {
  it('membiarkan teks yang sudah cukup pendek', () => {
    expect(truncateAtWord('pendek', 50)).toBe('pendek');
  });

  it('memotong di batas kata dan menambahkan elipsis', () => {
    expect(truncateAtWord('satu dua tiga empat lima', 14)).toBe('satu dua tiga…');
  });

  it('tidak pernah membelah kata ketika ada spasi yang layak', () => {
    const hasil = truncateAtWord('kata panjang sekali di sini', 20);
    expect(hasil.includes('panjan…')).toBe(false);
  });

  it('memotong keras ketika spasi terakhir terlalu jauh ke depan', () => {
    // Satu kata sangat panjang: tidak ada batas kata yang bisa dipakai.
    expect(truncateAtWord('abcdefghijklmnop', 8)).toBe('abcdefgh…');
  });

  it('mengembalikan string kosong untuk batas nol', () => {
    expect(truncateAtWord('apa pun', 0)).toBe('');
  });
});

describe('buildExcerpt', () => {
  it('mengembalikan string kosong bila kronologi null', () => {
    expect(buildExcerpt(null)).toBe('');
  });

  it('mengembalikan string kosong bila kronologi kosong', () => {
    expect(buildExcerpt('')).toBe('');
  });

  it('meratakan baris baru sebelum memotong', () => {
    expect(buildExcerpt('baris satu\n\nbaris dua', 100)).toBe('baris satu baris dua');
  });

  it('memakai panjang bawaan 200 karakter', () => {
    const panjang = 'a'.repeat(50) + ' ' + 'b'.repeat(400);
    const hasil = buildExcerpt(panjang);
    // Paling banyak 200 karakter isi ditambah satu elipsis.
    expect(hasil.length > DEFAULT_EXCERPT_LENGTH + 1).toBe(false);
    expect(hasil.endsWith('…')).toBe(true);
  });

  it('menolak permintaan panjang di atas batas keras', () => {
    const panjang = 'kata '.repeat(500);
    const hasil = buildExcerpt(panjang, 10_000);
    expect(hasil.length > MAX_EXCERPT_LENGTH + 1).toBe(false);
  });

  it('tidak menambahkan elipsis bila tidak ada yang dipotong', () => {
    expect(buildExcerpt('singkat saja', 200)).toBe('singkat saja');
  });
});

describe('maskDestination', () => {
  it('menyisakan empat karakter terakhir pada nomor internasional', () => {
    const hasil = maskDestination('+6281234567890');
    expect(hasil).toMatch(/^\+62\*+7890$/);
  });

  it('menangani chat id Telegram berupa angka', () => {
    const hasil = maskDestination('123456789');
    expect(hasil).toMatch(/^12\*+6789$/);
  });

  it('menyamarkan seluruhnya bila terlalu pendek', () => {
    expect(maskDestination('123')).toBe('***');
  });

  it('tidak pernah menuliskan pengenal utuh', () => {
    const nomor = '+6281234567890';
    expect(maskDestination(nomor)).not.toBe(nomor);
  });
});

describe('summarizeGrounds', () => {
  it('menggabungkan kebijakan dan pasal dengan titik koma', () => {
    expect(summarizeGrounds(['Ujaran kebencian'], ['UU ITE Pasal 28 ayat (2)'])).toBe(
      'Ujaran kebencian; UU ITE Pasal 28 ayat (2)',
    );
  });

  it('tetap terbaca ketika hanya ada pasal', () => {
    expect(summarizeGrounds([], ['UU ITE Pasal 27A'])).toBe('UU ITE Pasal 27A');
  });

  it('memberi penanda jelas ketika keduanya kosong', () => {
    expect(summarizeGrounds([], [])).toBe('Tidak dirinci');
  });

  it('membuang label kosong', () => {
    expect(summarizeGrounds(['', '  '], ['Pasal 29'])).toBe('Pasal 29');
  });

  it('meratakan label yang memuat baris baru', () => {
    expect(summarizeGrounds(['Ujaran\nkebencian'], [])).toBe('Ujaran kebencian');
  });
});

describe('formatPackage', () => {
  it('memberi pemisah ribuan pada angka besar', () => {
    expect(formatPackage(1000)).toBe('1.000 laporan');
  });

  it('menampilkan angka kecil apa adanya', () => {
    expect(formatPackage(300)).toBe('300 laporan');
  });

  it('menandai ketiadaan data, bukan menampilkannya sebagai nol', () => {
    expect(formatPackage(null)).toBe('tidak tercatat');
  });
});

describe('formatJakartaTime', () => {
  it('memakai zona Asia/Jakarta, bukan UTC', () => {
    // 07:31 UTC adalah 14:31 WIB.
    expect(formatJakartaTime(OCCURRED_AT)).toMatch(/14[.:]31/);
  });
});

describe('buildAdminNotification', () => {
  it('memuat kode report, target, dan tautan panel', () => {
    const hasil = buildAdminNotification(input());
    expect(hasil.text).toContain('RPT-R2QGGWHNM7');
    expect(hasil.text).toContain('https://example.com/p/abc123');
    expect(hasil.text).toContain('/admin/report/RPT-R2QGGWHNM7');
  });

  it('tidak pernah memuat identitas pelapor', () => {
    // Nama dan email memang tidak ada di bentuk masukan; uji ini menjaga agar
    // tidak ada yang menambahkannya diam-diam di kemudian hari.
    const hasil = buildAdminNotification(input());
    expect(Object.keys(input())).not.toContain('userFullName');
    expect(hasil.text.toLowerCase()).not.toContain('@');
  });

  it('menyatakan dengan jelas ketika kronologi tidak diisi', () => {
    const hasil = buildAdminNotification(input({ description: null }));
    expect(hasil.text).toContain('Kronologi: tidak diisi');
  });

  it('menyatakan dengan jelas ketika URL target tidak tersedia', () => {
    const hasil = buildAdminNotification(input({ targetUrl: null }));
    expect(hasil.text).toContain('Target: Tidak tersedia');
  });

  it('menggabungkan jenis tindakan dan platform', () => {
    const hasil = buildAdminNotification(input());
    expect(hasil.text).toContain('Jenis: Takedown konten · Instagram');
  });

  it('menghilangkan baris jenis ketika keduanya kosong', () => {
    const hasil = buildAdminNotification(
      input({ actionTypeName: null, platformName: null }),
    );
    expect(hasil.text).not.toContain('Jenis:');
  });

  it('menghasilkan enam parameter dengan urutan tetap', () => {
    const hasil = buildAdminNotification(input());
    expect(hasil.parameters).toHaveLength(6);
    expect(hasil.parameters[0]).toBe('RPT-R2QGGWHNM7');
    expect(hasil.parameters[2]).toBe('https://example.com/p/abc123');
    expect(hasil.parameters[4]).toContain('/admin/report/');
    expect(hasil.parameters[5]).toBe('500 laporan');
  });

  it('mencantumkan paket yang dibeli pelapor', () => {
    const hasil = buildAdminNotification(input({ packageQuantity: 1000 }));
    expect(hasil.text).toContain('Paket: 1.000 laporan');
  });

  it('tetap menyusun pesan ketika paket tidak tercatat', () => {
    const hasil = buildAdminNotification(input({ packageQuantity: null }));
    expect(hasil.text).toContain('Paket: tidak tercatat');
  });

  it('tidak pernah menyisipkan baris baru ke dalam parameter', () => {
    const hasil = buildAdminNotification(
      input({ description: 'baris satu\nbaris dua\nbaris tiga' }),
    );
    const adaBarisBaru = hasil.parameters.some((value) => value.includes('\n'));
    expect(adaBarisBaru).toBe(false);
  });

  it('membatasi panjang tiap parameter', () => {
    const hasil = buildAdminNotification(
      input({ policyLabels: ['x'.repeat(3000)], articleLabels: [] }),
    );
    const terlaluPanjang = hasil.parameters.some(
      (value) => value.length > MAX_PARAMETER_LENGTH + 1,
    );
    expect(terlaluPanjang).toBe(false);
  });

  it('mengisi parameter kutipan dengan penanda ketika kronologi kosong', () => {
    const hasil = buildAdminNotification(input({ description: null }));
    expect(hasil.parameters[3]).toBe('tidak diisi');
  });

  it('mencantumkan jumlah bukti', () => {
    const hasil = buildAdminNotification(input({ evidenceCount: 0 }));
    expect(hasil.text).toContain('Bukti: 0 berkas');
  });

  it('memotong kronologi panjang pada teks maupun parameter', () => {
    const panjang = 'kata '.repeat(300);
    const hasil = buildAdminNotification(input({ description: panjang }));
    expect(hasil.text).toContain('…');
    expect(hasil.parameters[3]).toContain('…');
  });
});
