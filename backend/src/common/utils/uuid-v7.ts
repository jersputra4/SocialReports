import { randomBytes } from 'node:crypto';

/**
 * UUID versi 7 (RFC 9562): 48 bit timestamp milidetik + 74 bit acak.
 * Dipakai untuk seluruh primary key (BRD/SRS v1.1 §4.5 "Identitas objek")
 * sehingga index tetap terurut waktu tanpa membocorkan urutan bisnis —
 * identitas publik yang tidak boleh ditebak memakai `report_code` terpisah.
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = randomBytes(16);

  // 48 bit pertama: timestamp milidetik big-endian.
  bytes[0] = (now / 2 ** 40) & 0xff;
  bytes[1] = (now / 2 ** 32) & 0xff;
  bytes[2] = (now / 2 ** 24) & 0xff;
  bytes[3] = (now / 2 ** 16) & 0xff;
  bytes[4] = (now / 2 ** 8) & 0xff;
  bytes[5] = now & 0xff;

  // Versi 7 pada 4 bit teratas oktet ke-7.
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  // Varian RFC 4122 pada 2 bit teratas oktet ke-9.
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}
