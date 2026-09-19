import { escapeHtml } from '../common/utils/sanitize.util';

export interface MailContent {
  subject: string;
  text: string;
  html: string;
  /** Nilai yang disorot pada kotak masuk pengembangan (OTP/token). */
  highlight?: string;
}

function layout(title: string, bodyHtml: string, appName: string): string {
  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:24px;background:#f4f5f7;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#1f2933">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;border:1px solid #e4e7eb">
    <p style="margin:0 0 24px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#7b8794">${escapeHtml(appName)}</p>
    ${bodyHtml}
    <hr style="border:0;border-top:1px solid #e4e7eb;margin:32px 0 16px">
    <p style="margin:0;font-size:12px;color:#7b8794">
      Email ini dikirim otomatis. Mohon tidak membalas email ini.
    </p>
  </div>
</body></html>`;
}

/**
 * Seluruh teks dari pengguna di-escape sebelum masuk HTML (AC-35).
 * Email notifikasi tidak pernah memuat URL target, isi evidence, nama, atau
 * nomor telepon — hanya kode report dan tautan yang menuntut login (BRD 4.4).
 */
export const MailTemplates = {
  emailVerification(appName: string, link: string, ttlHours: number): MailContent {
    const safeLink = escapeHtml(link);
    return {
      subject: `Verifikasi alamat email Anda — ${appName}`,
      highlight: link,
      text: [
        'Selesaikan pendaftaran dengan membuka tautan berikut:',
        link,
        '',
        `Tautan berlaku ${ttlHours} jam dan hanya dapat dipakai satu kali.`,
        'Abaikan email ini bila Anda tidak merasa mendaftar.',
      ].join('\n'),
      html: layout(
        'Verifikasi email',
        `<h1 style="margin:0 0 16px;font-size:20px">Verifikasi alamat email Anda</h1>
         <p style="margin:0 0 24px;line-height:1.6">Satu langkah lagi sebelum Anda dapat membuat report.</p>
         <p style="margin:0 0 24px">
           <a href="${safeLink}" style="display:inline-block;background:#1f6feb;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Verifikasi email</a>
         </p>
         <p style="margin:0 0 8px;font-size:13px;color:#52606d;line-height:1.6">
           Tautan berlaku ${ttlHours} jam dan hanya dapat dipakai satu kali.<br>
           Abaikan email ini bila Anda tidak merasa mendaftar.
         </p>`,
        appName,
      ),
    };
  },

  loginOtp(appName: string, otp: string, ttlMinutes: number): MailContent {
    return {
      subject: `Kode masuk ${otp} — ${appName}`,
      highlight: otp,
      text: [
        `Kode verifikasi masuk Anda: ${otp}`,
        '',
        `Kode berlaku ${ttlMinutes} menit dan hanya untuk satu percobaan masuk.`,
        'Bila bukan Anda yang mencoba masuk, segera ganti kata sandi Anda.',
      ].join('\n'),
      html: layout(
        'Kode masuk',
        `<h1 style="margin:0 0 16px;font-size:20px">Kode verifikasi masuk</h1>
         <p style="margin:0 0 20px;line-height:1.6">Masukkan kode berikut untuk menyelesaikan proses masuk.</p>
         <p style="margin:0 0 24px;font-size:32px;letter-spacing:.3em;font-weight:700;font-family:ui-monospace,monospace">${escapeHtml(otp)}</p>
         <p style="margin:0;font-size:13px;color:#52606d;line-height:1.6">
           Kode berlaku ${ttlMinutes} menit dan hanya untuk satu percobaan masuk.<br>
           Bila bukan Anda yang mencoba masuk, segera ganti kata sandi Anda.
         </p>`,
        appName,
      ),
    };
  },

  stepUpOtp(appName: string, otp: string, ttlMinutes: number): MailContent {
    return {
      subject: `Kode konfirmasi ${otp} — ${appName}`,
      highlight: otp,
      text: [
        `Kode konfirmasi tindakan sensitif: ${otp}`,
        '',
        `Kode berlaku ${ttlMinutes} menit.`,
        'Bila bukan Anda yang melakukannya, hubungi administrator.',
      ].join('\n'),
      html: layout(
        'Kode konfirmasi',
        `<h1 style="margin:0 0 16px;font-size:20px">Konfirmasi tindakan sensitif</h1>
         <p style="margin:0 0 20px;line-height:1.6">Masukkan kode berikut untuk melanjutkan.</p>
         <p style="margin:0 0 24px;font-size:32px;letter-spacing:.3em;font-weight:700;font-family:ui-monospace,monospace">${escapeHtml(otp)}</p>
         <p style="margin:0;font-size:13px;color:#52606d">Kode berlaku ${ttlMinutes} menit.</p>`,
        appName,
      ),
    };
  },

  passwordReset(appName: string, link: string, ttlMinutes: number): MailContent {
    const safeLink = escapeHtml(link);
    return {
      subject: `Atur ulang kata sandi — ${appName}`,
      highlight: link,
      text: [
        'Buka tautan berikut untuk mengatur ulang kata sandi Anda:',
        link,
        '',
        `Tautan berlaku ${ttlMinutes} menit dan hanya dapat dipakai satu kali.`,
        'Seluruh sesi aktif akan dikeluarkan setelah kata sandi diubah.',
      ].join('\n'),
      html: layout(
        'Atur ulang kata sandi',
        `<h1 style="margin:0 0 16px;font-size:20px">Atur ulang kata sandi</h1>
         <p style="margin:0 0 24px;line-height:1.6">Bila Anda tidak meminta ini, abaikan saja email ini — kata sandi Anda tidak berubah.</p>
         <p style="margin:0 0 24px">
           <a href="${safeLink}" style="display:inline-block;background:#1f6feb;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Atur ulang kata sandi</a>
         </p>
         <p style="margin:0;font-size:13px;color:#52606d;line-height:1.6">
           Tautan berlaku ${ttlMinutes} menit dan hanya dapat dipakai satu kali.<br>
           Seluruh sesi aktif akan dikeluarkan setelah kata sandi diubah.
         </p>`,
        appName,
      ),
    };
  },

  /** Payload minimal — hanya kode report dan tautan yang menuntut login. */
  proofUploaded(appName: string, reportCode: string, link: string): MailContent {
    const safeCode = escapeHtml(reportCode);
    const safeLink = escapeHtml(link);
    return {
      subject: `Bukti pengerjaan baru untuk ${reportCode}`,
      text: [
        `Ada bukti pengerjaan baru pada report ${reportCode}.`,
        '',
        `Buka detail report untuk melihatnya: ${link}`,
        '(Anda perlu masuk terlebih dahulu.)',
      ].join('\n'),
      html: layout(
        'Bukti pengerjaan baru',
        `<h1 style="margin:0 0 16px;font-size:20px">Bukti pengerjaan baru</h1>
         <p style="margin:0 0 24px;line-height:1.6">Report <strong>${safeCode}</strong> memiliki bukti pengerjaan baru.</p>
         <p style="margin:0 0 24px">
           <a href="${safeLink}" style="display:inline-block;background:#1f6feb;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Lihat detail report</a>
         </p>
         <p style="margin:0;font-size:13px;color:#52606d">Anda perlu masuk terlebih dahulu untuk melihatnya.</p>`,
        appName,
      ),
    };
  },

  reportCompleted(appName: string, reportCode: string, link: string): MailContent {
    const safeCode = escapeHtml(reportCode);
    const safeLink = escapeHtml(link);
    return {
      subject: `Report ${reportCode} selesai dikerjakan`,
      text: [
        `Report ${reportCode} sudah berstatus selesai.`,
        '',
        `Buka detail report untuk melihat bukti pengerjaannya: ${link}`,
        '(Anda perlu masuk terlebih dahulu.)',
      ].join('\n'),
      html: layout(
        'Report selesai',
        `<h1 style="margin:0 0 16px;font-size:20px">Report selesai dikerjakan</h1>
         <p style="margin:0 0 24px;line-height:1.6">Report <strong>${safeCode}</strong> sudah berstatus selesai. Bukti pengerjaan dapat dilihat pada halaman detail.</p>
         <p style="margin:0 0 24px">
           <a href="${safeLink}" style="display:inline-block;background:#1f6feb;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Lihat detail report</a>
         </p>
         <p style="margin:0;font-size:13px;color:#52606d">Anda perlu masuk terlebih dahulu untuk melihatnya.</p>`,
        appName,
      ),
    };
  },
};
