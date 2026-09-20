/**
 * Lampiran email.
 *
 * Nama berkas lampiran berasal dari unggahan pengguna dan berakhir di dalam
 * header MIME. Tanpa pembersihan, nama seperti `a"; x=y` atau nama yang memuat
 * baris baru dapat menyuntikkan header tambahan ke pesan yang keluar. Berkas
 * ini memusatkan pembersihan itu, beserta dua aturan lain yang mudah terlupa:
 * batas ukuran total, dan nama ganda.
 *
 * Seluruh isinya fungsi murni tanpa nodemailer maupun Prisma, sehingga dapat
 * diuji sendiri dan dipakai ulang oleh job pengiriman.
 */

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

/**
 * Batas keras ukuran total lampiran sebelum encoding.
 *
 * Email mengangkut lampiran dalam base64, yang membesarkan ukuran sekitar
 * sepertiga. Jadi 15 MB berkas menjadi kira-kira 20,5 MB pesan — masih di
 * bawah batas 25 MB yang umum dipakai penyedia surel. Batas per fitur boleh
 * lebih ketat dari ini; angka di sini hanya pagar terakhir agar sistem tidak
 * pernah mencoba mengirim pesan yang pasti ditolak server tujuan.
 */
export const MAX_TOTAL_ATTACHMENT_BYTES = 15 * 1024 * 1024;

/** Perbandingan ukuran base64 terhadap ukuran asli. */
export const BASE64_RATIO = 4 / 3;

export const MAX_ATTACHMENT_NAME_LENGTH = 120;

export class AttachmentTooLargeError extends Error {
  constructor(
    readonly totalBytes: number,
    readonly limitBytes: number,
  ) {
    super(
      `Total lampiran ${totalBytes} byte melebihi batas ${limitBytes} byte ` +
        `(sekitar ${Math.round((totalBytes * BASE64_RATIO) / 1024 / 1024)} MB setelah encoding).`,
    );
    this.name = 'AttachmentTooLargeError';
  }
}

/**
 * Membersihkan nama berkas lampiran.
 *
 * Yang dibuang: karakter kendali, baris baru, pemisah path, tanda kutip, dan
 * titik koma. Empat yang terakhir bukan soal kerapian — semuanya punya arti
 * khusus di header MIME atau pada sistem berkas penerima.
 */
export function sanitizeAttachmentName(
  name: string | null | undefined,
  fallback = 'lampiran',
): string {
  const cleaned = (name ?? '')
    // karakter kendali termasuk CR dan LF
    .replace(/[\u0000-\u001f\u007f]/g, '')
    // karakter pembalik arah yang dapat menyamarkan ekstensi
    .replace(/[‪-‮⁦-⁩]/g, '')
    // pemisah path: nama lampiran tidak boleh menunjuk direktori
    .replace(/[\\/]/g, '-')
    // bermakna khusus di header MIME
    .replace(/["';]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    // titik beruntun dipakai untuk menaiki direktori
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+/, '');

  if (cleaned.length === 0) return fallback;
  if (cleaned.length <= MAX_ATTACHMENT_NAME_LENGTH) return cleaned;

  // Pemotongan mempertahankan ekstensi agar penerima tetap tahu jenis berkas.
  const dot = cleaned.lastIndexOf('.');
  if (dot > 0 && cleaned.length - dot <= 10) {
    const extension = cleaned.slice(dot);
    const stem = cleaned.slice(0, MAX_ATTACHMENT_NAME_LENGTH - extension.length);
    return `${stem}${extension}`;
  }

  return cleaned.slice(0, MAX_ATTACHMENT_NAME_LENGTH);
}

/**
 * Membuat setiap nama unik.
 *
 * Dua lampiran bernama sama membuat sebagian klien surel menimpa yang pertama,
 * sehingga penerima diam-diam kehilangan satu bukti. Nama kedua dan seterusnya
 * diberi akhiran angka sebelum ekstensi.
 */
export function deduplicateNames(names: readonly string[]): string[] {
  const used = new Map<string, number>();
  const result: string[] = [];

  for (const name of names) {
    const key = name.toLowerCase();
    const seen = used.get(key) ?? 0;
    used.set(key, seen + 1);

    if (seen === 0) {
      result.push(name);
      continue;
    }

    const dot = name.lastIndexOf('.');
    const suffix = `-${seen + 1}`;
    result.push(
      dot > 0 ? `${name.slice(0, dot)}${suffix}${name.slice(dot)}` : `${name}${suffix}`,
    );
  }

  return result;
}

export function totalAttachmentBytes(attachments: readonly MailAttachment[]): number {
  return attachments.reduce((sum, item) => sum + item.content.length, 0);
}

export function assertAttachmentsWithinLimit(
  attachments: readonly MailAttachment[],
  limitBytes = MAX_TOTAL_ATTACHMENT_BYTES,
): void {
  const total = totalAttachmentBytes(attachments);
  if (total > limitBytes) throw new AttachmentTooLargeError(total, limitBytes);
}

/**
 * Menyiapkan lampiran untuk dikirim: nama dibersihkan, nama ganda dibedakan,
 * lalu ukuran total diperiksa. Melempar `AttachmentTooLargeError` bila lewat
 * batas, supaya job pemanggil dapat mencatatnya sebagai kegagalan yang jelas
 * alih-alih memotong lampiran diam-diam.
 */
export function prepareAttachments(
  attachments: readonly MailAttachment[],
  limitBytes = MAX_TOTAL_ATTACHMENT_BYTES,
): MailAttachment[] {
  const names = deduplicateNames(
    attachments.map((item) => sanitizeAttachmentName(item.filename)),
  );

  const prepared = attachments.map((item, index) => ({
    ...item,
    filename: names[index],
  }));

  assertAttachmentsWithinLimit(prepared, limitBytes);
  return prepared;
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Ringkasan lampiran untuk kotak masuk pengembangan.
 *
 * Driver `mailbox` tidak mengirim apa pun, jadi isi berkas tidak disimpan.
 * Yang disimpan hanya daftar nama dan ukuran, supaya saat menguji alur kita
 * tetap dapat melihat lampiran apa yang akan ikut terkirim.
 */
export function describeAttachments(attachments: readonly MailAttachment[]): string {
  if (attachments.length === 0) return '';

  const lines = attachments.map(
    (item, index) => `${index + 1}. ${item.filename} (${formatBytes(item.content.length)})`,
  );

  return [
    '',
    `--- ${attachments.length} lampiran (tidak dikirim pada driver mailbox) ---`,
    ...lines,
  ].join('\n');
}
