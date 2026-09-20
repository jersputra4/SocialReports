/**
 * Pemetaan status report ke tampilan.
 *
 * Warna status berasal dari palet status yang sudah tervalidasi. Dua di
 * antaranya (`warning` dan `serious`) berada di bawah rasio kontras 3:1 pada
 * permukaan terang — karena itu setiap lencana WAJIB membawa ikon dan teks,
 * dan warna tidak pernah menjadi satu-satunya pembawa makna.
 */

export type StatusTone = 'neutral' | 'good' | 'warning' | 'serious' | 'critical';

export interface StatusPresentation {
  label: string;
  tone: StatusTone;
  /** Glyph teks, bukan emoji berwarna, agar tetap terbaca saat dicetak. */
  glyph: string;
  description: string;
}

export const REPORT_STATUS: Record<string, StatusPresentation> = {
  DRAFT: {
    label: 'Draf',
    tone: 'neutral',
    glyph: '◦',
    description: 'Masih disusun. Belum ada tagihan dan isinya masih dapat diubah.',
  },
  WAITING_PAYMENT: {
    label: 'Menunggu pembayaran',
    tone: 'warning',
    glyph: '◔',
    description: 'Tagihan sudah dibuat. Selesaikan pembayaran sebelum batas waktu.',
  },
  PAYMENT_REVIEW: {
    label: 'Pembayaran ditinjau',
    tone: 'serious',
    glyph: '◑',
    description: 'Jumlah yang masuk belum sesuai tagihan. Tim Finance sedang memeriksa.',
  },
  PAYMENT_REJECTED: {
    label: 'Pembayaran ditolak',
    tone: 'critical',
    glyph: '✕',
    description: 'Pembayaran tidak dapat diterima. Anda dapat membuat tagihan baru.',
  },
  EXPIRED: {
    label: 'Tagihan kedaluwarsa',
    tone: 'critical',
    glyph: '⏱',
    description: 'Tagihan lewat batas waktu. Tagihan baru dapat dibuat dalam 7 hari.',
  },
  PAID: {
    label: 'Lunas',
    tone: 'good',
    glyph: '✓',
    description: 'Pembayaran terkonfirmasi. Invoice sudah diterbitkan.',
  },
  WAITING_REVIEW: {
    label: 'Menunggu review',
    tone: 'warning',
    glyph: '◔',
    description: 'Report masuk antrean peninjauan kelayakan.',
  },
  APPROVED: {
    label: 'Disetujui',
    tone: 'good',
    glyph: '✓',
    description: 'Report layak dilaporkan. Menunggu admin melapor ke platform.',
  },
  REJECTED: {
    label: 'Ditolak',
    tone: 'critical',
    glyph: '✕',
    description: 'Report tidak memenuhi kriteria. Status ini final.',
  },
  NEEDS_REVISION: {
    label: 'Perlu perbaikan',
    tone: 'serious',
    glyph: '↻',
    description: 'Ada yang perlu diperbaiki. Perbaikan tidak memerlukan pembayaran baru.',
  },
  SUBMITTED: {
    label: 'Sudah dilaporkan',
    tone: 'good',
    glyph: '➤',
    description: 'Admin sudah melapor ke platform lewat jalur resmi.',
  },
  PARTIALLY_COMPLETED: {
    label: 'Selesai sebagian',
    tone: 'serious',
    glyph: '◑',
    description: 'Sebagian unit sudah dikerjakan. Sisanya masih berjalan.',
  },
  COMPLETED: {
    label: 'Selesai',
    tone: 'good',
    glyph: '✓',
    description: 'Seluruh unit sudah dikerjakan dan bukti pengerjaan tersedia.',
  },
  FAILED: {
    label: 'Gagal dilaporkan',
    tone: 'critical',
    glyph: '!',
    description: 'Pelaporan ke platform gagal. Admin dapat mencoba ulang.',
  },
  CANCELLED: {
    label: 'Dibatalkan',
    tone: 'neutral',
    glyph: '⊘',
    description: 'Report dibatalkan. Tidak ada pengembalian dana.',
  },
  ARCHIVED: {
    label: 'Diarsipkan',
    tone: 'neutral',
    glyph: '▤',
    description: 'Report diarsipkan sesuai kebijakan retensi.',
  },
};

export function presentStatus(status: string): StatusPresentation {
  return (
    REPORT_STATUS[status] ?? {
      label: status,
      tone: 'neutral',
      glyph: '•',
      description: '',
    }
  );
}

export const PAYMENT_STATUS: Record<string, StatusPresentation> = {
  PENDING: { label: 'Menunggu', tone: 'warning', glyph: '◔', description: 'Menunggu pembayaran masuk.' },
  SETTLED: { label: 'Lunas', tone: 'good', glyph: '✓', description: 'Pembayaran terkonfirmasi gateway.' },
  MANUAL_REVIEW: { label: 'Ditinjau', tone: 'serious', glyph: '◑', description: 'Menunggu keputusan Finance.' },
  EXPIRED: { label: 'Kedaluwarsa', tone: 'critical', glyph: '⏱', description: 'Lewat batas waktu.' },
  FAILED: { label: 'Gagal', tone: 'critical', glyph: '✕', description: 'Pembayaran tidak dapat diproses.' },
};

/** Urutan tahapan utama untuk tampilan ringkas di dasbor. */
export const MAIN_STAGES: Array<{ status: string; short: string }> = [
  { status: 'WAITING_PAYMENT', short: 'Menunggu bayar' },
  { status: 'WAITING_REVIEW', short: 'Antre review' },
  { status: 'APPROVED', short: 'Disetujui' },
  { status: 'SUBMITTED', short: 'Dilaporkan' },
  { status: 'PARTIALLY_COMPLETED', short: 'Selesai sebagian' },
  { status: 'COMPLETED', short: 'Selesai' },
];

export const PROOF_TYPE_LABEL: Record<string, string> = {
  POST_REPORTED: 'Postingan dilaporkan',
  ACCOUNT_REPORTED: 'Akun dilaporkan',
  OTHER: 'Lainnya',
};

export const CHANNEL_LABEL: Record<string, string> = {
  IN_APP_FORM: 'Formulir dalam aplikasi platform',
  EMAIL: 'Email resmi platform',
  WEB_FORM: 'Formulir web platform',
  LAW_ENFORCEMENT_PORTAL: 'Portal penegak hukum',
  KOMDIGI_EMAIL: 'Email aduan Komdigi',
};

/**
 * Kanal yang boleh dicatat manual oleh admin.
 *
 * `KOMDIGI_EMAIL` sengaja tidak ada di sini: baris kanal itu dibuat oleh alur
 * penerusan otomatis, lengkap dengan nomor surat dan hash berkas. Membiarkan
 * admin mencatatnya manual akan menghasilkan baris yang mengaku terkirim
 * tanpa surat yang benar-benar dikirim.
 */
export const MANUAL_CHANNELS = [
  'IN_APP_FORM',
  'EMAIL',
  'WEB_FORM',
  'LAW_ENFORCEMENT_PORTAL',
] as const;
