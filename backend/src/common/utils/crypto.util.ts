import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** SHA-256 heksadesimal. Dipakai untuk hash token dan hash berkas. */
export function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Token opaque acak (default 32 byte = 64 karakter hex). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

/**
 * OTP 6 digit dari CSPRNG (BRD 4.3).
 * `randomInt` memakai rejection sampling sehingga distribusinya rata —
 * berbeda dengan `Math.random()` atau modulo pada byte acak.
 */
export function generateOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/** Perbandingan waktu-tetap untuk string heksadesimal/base64 sepanjang apa pun. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Tetap lakukan satu perbandingan agar waktu eksekusi tidak membocorkan panjang.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/** HMAC-SHA256 heksadesimal. */
export function hmacSha256Hex(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Tanda tangan webhook keluar/masuk: HMAC atas `timestamp + "." + body`.
 * Timestamp ikut ditandatangani agar signature lama tidak dapat diputar ulang.
 */
export function signWebhook(secret: string, timestamp: string, body: string): string {
  return hmacSha256Hex(secret, `${timestamp}.${body}`);
}

export function verifyWebhookSignature(
  secret: string,
  timestamp: string,
  body: string,
  signature: string,
  toleranceSeconds: number,
): { valid: boolean; reason?: string } {
  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) {
    return { valid: false, reason: 'timestamp tidak valid' };
  }
  const skew = Math.abs(Math.floor(Date.now() / 1000) - ts);
  if (skew > toleranceSeconds) {
    return { valid: false, reason: `selisih waktu ${skew} detik melebihi toleransi` };
  }
  if (!safeEqual(signWebhook(secret, timestamp, body), signature)) {
    return { valid: false, reason: 'tanda tangan tidak cocok' };
  }
  return { valid: true };
}
