/**
 * State machine report — BRD/SRS v1.1 §7.
 *
 * Tabel 7.2 disalin apa adanya ke dalam `TRANSITIONS`. Transisi yang tidak ada
 * di tabel ditolak; controller menerjemahkan penolakan itu menjadi HTTP 409
 * (AC-23). Berkas ini sengaja tidak mengimpor apa pun agar aturannya dapat
 * diuji terpisah dari database dan framework.
 */

export type ReportStatusValue =
  | 'DRAFT'
  | 'WAITING_PAYMENT'
  | 'PAYMENT_REVIEW'
  | 'PAYMENT_REJECTED'
  | 'EXPIRED'
  | 'PAID'
  | 'WAITING_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'NEEDS_REVISION'
  | 'SUBMITTED'
  | 'PARTIALLY_COMPLETED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'ARCHIVED';

export type TransitionActor = 'USER' | 'REVIEWER' | 'ADMIN' | 'FINANCE' | 'SYSTEM';

/** Prasyarat yang harus dipenuhi sebelum transisi dijalankan. */
export type TransitionGuard =
  | 'DATA_COMPLETE'          // data report lengkap dan valid
  | 'EMAIL_VERIFIED'         // email user sudah terverifikasi
  | 'NO_REFUND_CONSENT'      // persetujuan tanpa refund tercatat
  | 'SNAPSHOT_SEALED'        // snapshot harga/policy/legal/target dibekukan
  | 'PAYMENT_ORDER_CREATED'  // order gateway sudah dibuat
  | 'PAYMENT_SETTLED'        // pembayaran terkonfirmasi >= total
  | 'PAYMENT_NOT_STARTED'    // belum ada dana masuk
  | 'REVIEW_DECISION'        // keputusan review tercatat
  | 'COMPLAINT_SUBMISSION'   // ada record complaint_submissions
  | 'ACTIVE_PROOF'           // ada >= 1 bukti pengerjaan aktif & terlihat user
  | 'UNITS_FULFILLED'        // jumlah units_reported >= package_quantity
  | 'UNITS_PARTIAL'          // jumlah units_reported < package_quantity
  | 'RETRY_WINDOW'           // masih dalam 7 hari sejak kedaluwarsa
  | 'RETRY_WINDOW_ELAPSED'   // lewat 7 hari sejak kedaluwarsa
  | 'EXPIRY_ELAPSED'         // melewati expires_at
  | 'RETENTION_POLICY';      // sesuai kebijakan retensi

export interface TransitionRule {
  /** Nomor baris pada tabel 7.2 dokumen, untuk telusur balik. */
  id: number;
  from: ReportStatusValue;
  to: ReportStatusValue;
  actors: TransitionActor[];
  /** Alasan wajib diisi dan disimpan di report_status_history. */
  reasonRequired: boolean;
  guards: TransitionGuard[];
  note: string;
}

export const TRANSITIONS: readonly TransitionRule[] = [
  {
    id: 1, from: 'DRAFT', to: 'WAITING_PAYMENT', actors: ['USER'], reasonRequired: false,
    guards: ['DATA_COMPLETE', 'EMAIL_VERIFIED', 'NO_REFUND_CONSENT', 'SNAPSHOT_SEALED', 'PAYMENT_ORDER_CREATED'],
    note: 'Snapshot harga/PPN, policy, legal, dan target dibuat lalu order gateway dibuat.',
  },
  { id: 2, from: 'DRAFT', to: 'CANCELLED', actors: ['USER'], reasonRequired: false, guards: [], note: 'User membatalkan draft.' },
  {
    id: 3, from: 'WAITING_PAYMENT', to: 'PAID', actors: ['SYSTEM'], reasonRequired: false,
    guards: ['PAYMENT_SETTLED'],
    note: 'Webhook valid dan status check gateway sukses; jumlah >= total.',
  },
  {
    id: 4, from: 'WAITING_PAYMENT', to: 'PAYMENT_REVIEW', actors: ['SYSTEM'], reasonRequired: true, guards: [],
    note: 'Kurang bayar, jumlah/order tidak cocok, atau status gateway ambigu.',
  },
  {
    id: 5, from: 'WAITING_PAYMENT', to: 'EXPIRED', actors: ['SYSTEM'], reasonRequired: false,
    guards: ['EXPIRY_ELAPSED'], note: 'Melewati expires_at (24 jam).',
  },
  {
    id: 6, from: 'WAITING_PAYMENT', to: 'CANCELLED', actors: ['USER'], reasonRequired: false,
    guards: ['PAYMENT_NOT_STARTED'], note: 'Belum ada pembayaran masuk.',
  },
  {
    id: 7, from: 'PAYMENT_REVIEW', to: 'PAID', actors: ['FINANCE', 'SYSTEM'], reasonRequired: true, guards: [],
    note: 'Top-up mencukupi atau verifikasi manual Finance; alasan wajib.',
  },
  { id: 8, from: 'PAYMENT_REVIEW', to: 'PAYMENT_REJECTED', actors: ['FINANCE'], reasonRequired: true, guards: [], note: 'Alasan wajib.' },
  {
    id: 9, from: 'PAYMENT_REJECTED', to: 'WAITING_PAYMENT', actors: ['USER'], reasonRequired: false,
    guards: ['PAYMENT_ORDER_CREATED'], note: 'Order baru; harga dihitung ulang.',
  },
  {
    id: 10, from: 'EXPIRED', to: 'WAITING_PAYMENT', actors: ['USER'], reasonRequired: false,
    guards: ['RETRY_WINDOW', 'PAYMENT_ORDER_CREATED'],
    note: 'Dalam 7 hari sejak kedaluwarsa; order baru; harga dihitung ulang.',
  },
  {
    id: 11, from: 'EXPIRED', to: 'CANCELLED', actors: ['SYSTEM'], reasonRequired: false,
    guards: ['RETRY_WINDOW_ELAPSED'], note: 'Lewat 7 hari.',
  },
  {
    id: 12, from: 'PAID', to: 'WAITING_REVIEW', actors: ['SYSTEM'], reasonRequired: false, guards: [],
    note: 'Otomatis; invoice diterbitkan; job PDF dibuat.',
  },
  {
    id: 13, from: 'WAITING_REVIEW', to: 'APPROVED', actors: ['REVIEWER', 'ADMIN'], reasonRequired: true,
    guards: ['REVIEW_DECISION'], note: 'Alasan/ceklis tercatat di review_decisions.',
  },
  {
    id: 14, from: 'WAITING_REVIEW', to: 'REJECTED', actors: ['REVIEWER', 'ADMIN'], reasonRequired: true,
    guards: ['REVIEW_DECISION'], note: 'Alasan wajib; status final.',
  },
  {
    id: 15, from: 'WAITING_REVIEW', to: 'NEEDS_REVISION', actors: ['REVIEWER', 'ADMIN'], reasonRequired: true,
    guards: ['REVIEW_DECISION'], note: 'Daftar perbaikan wajib.',
  },
  {
    id: 16, from: 'NEEDS_REVISION', to: 'WAITING_REVIEW', actors: ['USER'], reasonRequired: false,
    guards: ['DATA_COMPLETE'], note: 'Perbaikan dikirim; TANPA pembayaran baru.',
  },
  {
    id: 17, from: 'NEEDS_REVISION', to: 'CANCELLED', actors: ['USER', 'SYSTEM'], reasonRequired: false, guards: [],
    note: 'User membatalkan atau tidak ada tindakan 30 hari; tanpa refund.',
  },
  {
    id: 18, from: 'APPROVED', to: 'SUBMITTED', actors: ['ADMIN'], reasonRequired: false,
    guards: ['COMPLAINT_SUBMISSION'], note: 'Wajib ada record complaint_submissions (kanal, waktu, admin).',
  },
  {
    id: 19, from: 'SUBMITTED', to: 'PARTIALLY_COMPLETED', actors: ['ADMIN'], reasonRequired: false,
    guards: ['ACTIVE_PROOF', 'UNITS_PARTIAL'],
    note: '>= 1 bukti pengerjaan aktif dan jumlah units_reported < package_quantity.',
  },
  {
    id: 20, from: 'SUBMITTED', to: 'COMPLETED', actors: ['ADMIN'], reasonRequired: false,
    guards: ['ACTIVE_PROOF', 'UNITS_FULFILLED'],
    note: '>= 1 bukti aktif dan terlihat user; unit terpenuhi bila units_reported diisi.',
  },
  {
    id: 20, from: 'PARTIALLY_COMPLETED', to: 'COMPLETED', actors: ['ADMIN'], reasonRequired: false,
    guards: ['ACTIVE_PROOF', 'UNITS_FULFILLED'],
    note: 'Baris 20 tabel 7.2 mencakup SUBMITTED dan PARTIALLY_COMPLETED.',
  },
  { id: 21, from: 'SUBMITTED', to: 'FAILED', actors: ['ADMIN'], reasonRequired: true, guards: [], note: 'Alasan wajib.' },
  { id: 22, from: 'FAILED', to: 'SUBMITTED', actors: ['ADMIN'], reasonRequired: true, guards: [], note: 'Retry; retry_count bertambah; alasan wajib.' },
  { id: 23, from: 'FAILED', to: 'CANCELLED', actors: ['ADMIN'], reasonRequired: true, guards: [], note: 'Alasan wajib; tanpa refund.' },
  {
    id: 24, from: 'COMPLETED', to: 'ARCHIVED', actors: ['ADMIN', 'SYSTEM'], reasonRequired: false,
    guards: ['RETENTION_POLICY'], note: 'Soft archive sesuai kebijakan retensi.',
  },
  {
    id: 24, from: 'REJECTED', to: 'ARCHIVED', actors: ['ADMIN', 'SYSTEM'], reasonRequired: false,
    guards: ['RETENTION_POLICY'], note: 'Soft archive sesuai kebijakan retensi.',
  },
  {
    id: 24, from: 'CANCELLED', to: 'ARCHIVED', actors: ['ADMIN', 'SYSTEM'], reasonRequired: false,
    guards: ['RETENTION_POLICY'], note: 'Soft archive sesuai kebijakan retensi.',
  },
];

/** Status akhir: tidak ada transisi keluar selain ke ARCHIVED. */
export const TERMINAL_STATUSES: readonly ReportStatusValue[] = ['REJECTED', 'CANCELLED', 'ARCHIVED'];

/** Status yang membekukan seluruh kolom snapshot (BRD 6.2). */
export const SEALED_STATUSES: readonly ReportStatusValue[] = [
  'WAITING_PAYMENT', 'PAYMENT_REVIEW', 'PAYMENT_REJECTED', 'EXPIRED', 'PAID',
  'WAITING_REVIEW', 'APPROVED', 'REJECTED', 'NEEDS_REVISION', 'SUBMITTED',
  'PARTIALLY_COMPLETED', 'COMPLETED', 'FAILED', 'ARCHIVED',
];

/** Status tempat user masih boleh menyunting isi report. */
export const EDITABLE_STATUSES: readonly ReportStatusValue[] = ['DRAFT', 'NEEDS_REVISION'];

export function findTransition(
  from: ReportStatusValue,
  to: ReportStatusValue,
): TransitionRule | undefined {
  return TRANSITIONS.find((rule) => rule.from === from && rule.to === to);
}

export function isTransitionAllowed(from: ReportStatusValue, to: ReportStatusValue): boolean {
  return findTransition(from, to) !== undefined;
}

export function allowedTargets(from: ReportStatusValue): ReportStatusValue[] {
  return TRANSITIONS.filter((rule) => rule.from === from).map((rule) => rule.to);
}

export function allowedTargetsForActor(
  from: ReportStatusValue,
  actor: TransitionActor,
): ReportStatusValue[] {
  return TRANSITIONS.filter((rule) => rule.from === from && rule.actors.includes(actor)).map(
    (rule) => rule.to,
  );
}

export class TransitionNotAllowedError extends Error {
  constructor(
    readonly from: ReportStatusValue,
    readonly to: ReportStatusValue,
    readonly detail: string,
  ) {
    super(`Transisi ${from} -> ${to} ditolak: ${detail}`);
    this.name = 'TransitionNotAllowedError';
  }
}

export interface TransitionRequest {
  from: ReportStatusValue;
  to: ReportStatusValue;
  actor: TransitionActor;
  reason?: string | null;
  /** Guard yang sudah dipastikan terpenuhi oleh pemanggil. */
  satisfiedGuards?: readonly TransitionGuard[];
}

/**
 * Memvalidasi satu permintaan transisi.
 * Melempar TransitionNotAllowedError bila ditolak; mengembalikan aturan yang
 * dipakai bila diterima, agar pemanggil dapat mencatat nomor barisnya.
 */
export function assertTransition(request: TransitionRequest): TransitionRule {
  const rule = findTransition(request.from, request.to);

  if (!rule) {
    throw new TransitionNotAllowedError(
      request.from,
      request.to,
      'transisi tidak ada pada tabel 7.2',
    );
  }

  if (!rule.actors.includes(request.actor)) {
    throw new TransitionNotAllowedError(
      request.from,
      request.to,
      `aktor ${request.actor} tidak berwenang (diizinkan: ${rule.actors.join(', ')})`,
    );
  }

  if (rule.reasonRequired && (!request.reason || request.reason.trim().length < 10)) {
    throw new TransitionNotAllowedError(
      request.from,
      request.to,
      'alasan wajib diisi minimal 10 karakter',
    );
  }

  const satisfied = new Set(request.satisfiedGuards ?? []);
  const missing = rule.guards.filter((guard) => !satisfied.has(guard));
  if (missing.length > 0) {
    throw new TransitionNotAllowedError(
      request.from,
      request.to,
      `prasyarat belum terpenuhi: ${missing.join(', ')}`,
    );
  }

  return rule;
}
