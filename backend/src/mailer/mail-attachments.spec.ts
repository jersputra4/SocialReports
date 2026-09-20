import {
  AttachmentTooLargeError,
  MAX_ATTACHMENT_NAME_LENGTH,
  assertAttachmentsWithinLimit,
  deduplicateNames,
  describeAttachments,
  prepareAttachments,
  sanitizeAttachmentName,
  totalAttachmentBytes,
  type MailAttachment,
} from './mail-attachments';

function attachment(filename: string, bytes = 10): MailAttachment {
  return { filename, content: Buffer.alloc(bytes) };
}

describe('sanitizeAttachmentName', () => {
  it('membiarkan nama yang sudah bersih', () => {
    expect(sanitizeAttachmentName('bukti-1.png')).toBe('bukti-1.png');
    expect(sanitizeAttachmentName('Surat Aduan 2026.pdf')).toBe('Surat Aduan 2026.pdf');
  });

  it.each([
    ['bukti\u0000.png', 'bukti.png'],
    ['bukti\r\nBcc: orang@lain.com.png', 'buktiBcc: orang@lain.com.png'],
    ['../../etc/passwd', '-.-etc-passwd'],
    ['folder/sub/berkas.png', 'folder-sub-berkas.png'],
    ['a"; name=lain.png', 'a name=lain.png'],
    ['gambar‮gnp.exe', 'gambargnp.exe'],
  ])('membersihkan %p menjadi %p', (input, expected) => {
    expect(sanitizeAttachmentName(input)).toBe(expected);
  });

  it('tidak pernah memuat karakter baris baru atau kutip', () => {
    const hasil = sanitizeAttachmentName('a\nb\rc"d\'e;f/g\\h.png');

    for (const terlarang of ['\n', '\r', '"', "'", ';', '/', '\\']) {
      expect(hasil).not.toContain(terlarang);
    }
  });

  it.each([null, undefined, '', '   ', '...'])(
    'memakai nama cadangan untuk %p',
    (input) => {
      expect(sanitizeAttachmentName(input)).toBe('lampiran');
    },
  );

  it('memakai nama cadangan yang diberikan pemanggil', () => {
    expect(sanitizeAttachmentName('', 'surat.pdf')).toBe('surat.pdf');
  });

  it('memotong nama panjang tetapi mempertahankan ekstensi', () => {
    const panjang = `${'a'.repeat(300)}.png`;
    const hasil = sanitizeAttachmentName(panjang);

    expect(hasil.length).toBe(MAX_ATTACHMENT_NAME_LENGTH);
    expect(hasil.endsWith('.png')).toBe(true);
  });

  it('memotong nama panjang tanpa ekstensi yang masuk akal', () => {
    const hasil = sanitizeAttachmentName('b'.repeat(300));

    expect(hasil.length).toBe(MAX_ATTACHMENT_NAME_LENGTH);
  });
});

describe('deduplicateNames', () => {
  it('membiarkan nama yang sudah unik', () => {
    expect(deduplicateNames(['a.png', 'b.png'])).toEqual(['a.png', 'b.png']);
  });

  it('memberi akhiran angka pada nama kedua dan seterusnya', () => {
    expect(deduplicateNames(['a.png', 'a.png', 'a.png'])).toEqual([
      'a.png',
      'a-2.png',
      'a-3.png',
    ]);
  });

  it('menganggap beda huruf besar-kecil sebagai nama sama', () => {
    expect(deduplicateNames(['Bukti.PNG', 'bukti.png'])).toEqual([
      'Bukti.PNG',
      'bukti-2.png',
    ]);
  });

  it('menambahkan akhiran di akhir ketika tidak ada ekstensi', () => {
    expect(deduplicateNames(['lampiran', 'lampiran'])).toEqual(['lampiran', 'lampiran-2']);
  });
});

describe('batas ukuran', () => {
  it('menghitung total byte seluruh lampiran', () => {
    expect(totalAttachmentBytes([attachment('a', 100), attachment('b', 250)])).toBe(350);
  });

  it('meloloskan lampiran tepat di batas', () => {
    expect(() =>
      assertAttachmentsWithinLimit([attachment('a', 1000)], 1000),
    ).not.toThrow();
  });

  it('menolak lampiran satu byte di atas batas', () => {
    expect(() => assertAttachmentsWithinLimit([attachment('a', 1001)], 1000)).toThrow();
  });

  it('membawa angka total dan batas di dalam error', () => {
    try {
      assertAttachmentsWithinLimit([attachment('a', 2048)], 1024);
      throw new Error('seharusnya melempar');
    } catch (error) {
      expect(error).toBeInstanceOf(AttachmentTooLargeError);
      expect((error as AttachmentTooLargeError).totalBytes).toBe(2048);
      expect((error as AttachmentTooLargeError).limitBytes).toBe(1024);
    }
  });

  it('meloloskan daftar kosong', () => {
    expect(() => assertAttachmentsWithinLimit([], 0)).not.toThrow();
  });
});

describe('prepareAttachments', () => {
  it('membersihkan nama dan membedakan nama ganda sekaligus', () => {
    const hasil = prepareAttachments([
      attachment('folder/bukti.png'),
      attachment('folder\\bukti.png'),
    ]);

    expect(hasil.map((item) => item.filename)).toEqual([
      'folder-bukti.png',
      'folder-bukti-2.png',
    ]);
  });

  it('mempertahankan isi berkas apa adanya', () => {
    const isi = Buffer.from('halo');
    const [hasil] = prepareAttachments([{ filename: 'a.txt', content: isi }]);

    expect(hasil.content).toBe(isi);
  });

  it('mempertahankan contentType bila diberikan', () => {
    const [hasil] = prepareAttachments([
      { filename: 'a.pdf', content: Buffer.alloc(1), contentType: 'application/pdf' },
    ]);

    expect(hasil.contentType).toBe('application/pdf');
  });

  it('melempar ketika total melewati batas', () => {
    expect(() => prepareAttachments([attachment('a.png', 2048)], 1024)).toThrow(
      AttachmentTooLargeError,
    );
  });
});

describe('describeAttachments', () => {
  it('mengembalikan teks kosong untuk daftar kosong', () => {
    expect(describeAttachments([])).toBe('');
  });

  it('mencantumkan nomor, nama, dan ukuran tiap lampiran', () => {
    const teks = describeAttachments([
      attachment('surat.pdf', 2048),
      attachment('bukti.png', 3 * 1024 * 1024),
    ]);

    expect(teks).toContain('2 lampiran');
    expect(teks).toContain('1. surat.pdf (2.0 KB)');
    expect(teks).toContain('2. bukti.png (3.0 MB)');
  });

  it('menyatakan bahwa lampiran tidak ikut terkirim pada driver mailbox', () => {
    expect(describeAttachments([attachment('a.png')])).toContain('tidak dikirim');
  });
});
