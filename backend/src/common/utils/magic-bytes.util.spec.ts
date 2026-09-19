import { detectImage, hasDoubleExtension, sanitizeFileName } from './magic-bytes.util';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(16, 0),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16, 0)]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP', 'ascii'),
  Buffer.alloc(16, 0),
]);

describe('deteksi jenis berkas dari isi (AC-20)', () => {
  it('mengenali PNG, JPEG, dan WebP', () => {
    expect(detectImage(PNG)?.mime).toBe('image/png');
    expect(detectImage(JPEG)?.mime).toBe('image/jpeg');
    expect(detectImage(WEBP)?.mime).toBe('image/webp');
  });

  it('menolak HTML yang dinamai .png', () => {
    const html = Buffer.from('<html><script>alert(1)</script></html>', 'utf8');
    expect(detectImage(html)).toBeNull();
  });

  it('menolak SVG (dapat memuat skrip)', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>', 'utf8');
    expect(detectImage(svg)).toBeNull();
  });

  it('menolak PDF dan berkas kosong', () => {
    expect(detectImage(Buffer.from('%PDF-1.7\n', 'utf8'))).toBeNull();
    expect(detectImage(Buffer.alloc(0))).toBeNull();
    expect(detectImage(Buffer.alloc(4))).toBeNull();
  });
});

describe('sanitasi nama berkas', () => {
  it('membuang path dan memaksa ekstensi hasil deteksi', () => {
    expect(sanitizeFileName('../../etc/passwd', 'png')).toBe('passwd.png');
    expect(sanitizeFileName('C:\\Users\\a\\bukti.jpg', 'png')).toBe('bukti.png');
  });

  it('meratakan ekstensi ganda', () => {
    expect(sanitizeFileName('gambar.png.svg', 'png')).toBe('gambar.png');
    expect(sanitizeFileName('laporan.jpg.html', 'jpg')).toBe('laporan.jpg');
  });

  it('membuang karakter kendali dan mengganti karakter aneh', () => {
    // Karakter kendali dihapus seluruhnya; karakter lain yang tidak aman
    // diganti garis bawah agar nama tetap dapat dibaca.
    expect(sanitizeFileName('bu\u0000kti<>?.png', 'png')).toBe('bukti___.png');
  });

  it('selalu menghasilkan nama walaupun masukan kosong', () => {
    expect(sanitizeFileName('', 'png')).toBe('berkas.png');
    expect(sanitizeFileName('.png', 'png')).toBe('berkas.png');
  });

  it('mendeteksi ekstensi ganda pada nama asli', () => {
    expect(hasDoubleExtension('gambar.png.svg')).toBe(true);
    expect(hasDoubleExtension('gambar.png')).toBe(false);
  });
});
