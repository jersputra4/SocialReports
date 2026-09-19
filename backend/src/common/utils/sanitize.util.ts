/**
 * Penanganan teks bebas dari pengguna (AC-35).
 *
 * Aturan yang dipakai sistem ini: simpan apa adanya, escape saat ditampilkan.
 * React sudah meng-escape teks secara bawaan; fungsi di bawah dipakai untuk
 * jalur yang tidak melewati React — email HTML dan PDF.
 */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

/**
 * Teks yang masuk ke PDF. pdfmake memperlakukan string sebagai teks biasa
 * (bukan HTML), jadi yang perlu dibersihkan adalah karakter kendali dan
 * karakter pembalik arah yang dapat menyamarkan isi tulisan.
 */
export function sanitizeForPdf(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[‪-‮⁦-⁩]/g, '');
}

/** Memotong teks panjang untuk ringkasan di UI dan notifikasi. */
export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

/**
 * Menyamarkan alamat email pada log dan pesan galat.
 * Email tidak pernah dikirim dalam payload notifikasi (BRD 4.4).
 */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  const visible = local.slice(0, 1);
  return `${visible}${'*'.repeat(Math.max(1, local.length - 1))}@${domain}`;
}
