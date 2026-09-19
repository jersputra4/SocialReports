/**
 * Validasi jenis berkas berdasarkan isi, bukan ekstensi atau content-type yang
 * dikirim klien (BRD 8.2 dan AC-20).
 *
 * Hanya gambar yang diterima: PNG, JPEG, WebP. Deteksi dilakukan dengan membaca
 * magic bytes sehingga berkas `.png` yang sebenarnya HTML atau skrip tertolak.
 */

export type AllowedImageMime = 'image/png' | 'image/jpeg' | 'image/webp';

export interface DetectedFile {
  mime: AllowedImageMime;
  extension: 'png' | 'jpg' | 'webp';
}

export function detectImage(buffer: Buffer): DetectedFile | null {
  if (buffer.length < 12) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) {
    return { mime: 'image/png', extension: 'png' };
  }

  // JPEG: FF D8 FF ... dan diakhiri FF D9
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: 'image/jpeg', extension: 'jpg' };
  }

  // WebP: "RIFF" .... "WEBP"
  if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { mime: 'image/webp', extension: 'webp' };
  }

  return null;
}

/**
 * Menyaring nama berkas dari pengguna.
 * Menghapus path, karakter kendali, dan ekstensi ganda seperti
 * `gambar.png.svg` atau `laporan.jpg.html` yang dipakai untuk menipu pemeriksa
 * ekstensi sederhana.
 */
export function sanitizeFileName(original: string, enforcedExtension: string): string {
  const base = original.split(/[\\/]/).pop() ?? 'berkas';
  const withoutControl = base.replace(/[\u0000-\u001f\u007f]/g, '');
  const stem = withoutControl
    .replace(/\.[A-Za-z0-9]{1,8}$/g, '')      // buang ekstensi terakhir
    .replace(/\.[A-Za-z0-9]{1,8}$/g, '')      // dan satu lagi bila ekstensi ganda
    .replace(/[^A-Za-z0-9 ._-]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);

  const safeStem = stem.length > 0 ? stem : 'berkas';
  return `${safeStem}.${enforcedExtension}`;
}

/** Nama berkas dengan lebih dari satu ekstensi dianggap mencurigakan (AC-20). */
export function hasDoubleExtension(original: string): boolean {
  const base = original.split(/[\\/]/).pop() ?? '';
  return /\.[A-Za-z0-9]{1,8}\.[A-Za-z0-9]{1,8}$/.test(base);
}
