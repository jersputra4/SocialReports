import { randomInt } from 'node:crypto';

/**
 * Alfabet Crockford base32 — tanpa I, L, O, U sehingga tidak mudah salah baca
 * dan tidak membentuk kata yang tidak diinginkan.
 */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Karakter cek Crockford: jumlah nilai simbol modulo 37, memakai alfabet
 * diperluas. Kami batasi hasilnya ke alfabet dasar agar format tetap
 * `RPT-[0-9A-HJKMNP-TV-Z]{10}` seperti yang dijaga constraint database.
 */
function checkCharacter(body: string): string {
  let sum = 0;
  for (const ch of body) {
    sum = (sum + CROCKFORD.indexOf(ch)) % CROCKFORD.length;
  }
  return CROCKFORD[sum];
}

/**
 * Kode report publik: acak, tidak berurutan, 10 karakter (BRD 4.5).
 * 9 karakter acak + 1 karakter cek = ~2,8 x 10^13 kemungkinan, sehingga
 * enumerasi lewat tebakan tidak praktis. Keunikan tetap dijamin unique index.
 */
export function generateReportCode(): string {
  let body = '';
  for (let i = 0; i < 9; i += 1) {
    body += CROCKFORD[randomInt(0, CROCKFORD.length)];
  }
  return `RPT-${body}${checkCharacter(body)}`;
}

export function isValidReportCode(code: string): boolean {
  if (!/^RPT-[0-9A-HJKMNP-TV-Z]{10}$/.test(code)) return false;
  const payload = code.slice(4);
  return checkCharacter(payload.slice(0, 9)) === payload[9];
}

/**
 * Nomor invoice unik dan berurutan per tahun (BRD 6.5).
 * Urutan diambil dari sequence database, bukan dari hitungan baris.
 */
export function formatInvoiceNumber(year: number, sequence: number): string {
  return `INV/${year}/${sequence.toString().padStart(6, '0')}`;
}

/** ID order gateway yang mudah ditelusuri di dashboard penyedia. */
export function formatGatewayOrderId(reportCode: string, attempt: number): string {
  return `${reportCode}-${attempt.toString().padStart(2, '0')}`;
}
