/**
 * Gate kelayakan penerusan report ke Komdigi — jalur pelaporan resmi.
 *
 * Berkas ini menjawab satu pertanyaan saja: apakah sebuah report boleh
 * diteruskan ke kanal pengaduan konten Komdigi? Jawabannya harus dapat
 * dipertanggungjawabkan, karena surat yang dikirim mengatasnamakan sistem ini
 * kepada instansi negara. Maka syaratnya dibuat ketat dan eksplisit:
 * satu dasar hukum yang benar-benar tertaut ke pasal di basis data, bukan
 * teks bebas yang diketik pengguna.
 *
 * Seperti `reports/state-machine.ts`, berkas ini sengaja tidak mengimpor
 * apa pun selain tipe. Tidak ada Prisma, tidak ada Nest, tidak ada I/O.
 * Pemanggil yang menyiapkan datanya, sehingga aturannya dapat diuji tanpa
 * database dan dijalankan ulang di dalam job pengiriman tanpa biaya.
 */

import type { ReportStatusValue } from '../reports/state-machine';

// ------------------------------------------------------------- konstanta ---

/** Kode `laws.code` yang dipakai sebagai dasar permintaan pemutusan akses. */
export const KOMDIGI_LAW_CODE = 'UU_ITE';

/**
 * Pasal "Perbuatan yang Dilarang" UU ITE yang dapat menjadi dasar permintaan
 * pemutusan akses konten.
 *
 * Catatan penting: pasal di daftar ini adalah muatan yang dilanggar, BUKAN
 * dasar kewenangan pemutusan aksesnya. Kewenangan itu ada pada Pasal 40
 * ayat (2a) dan (2b) UU ITE dan dipegang pemerintah, bukan pelapor.
 *
 * Daftar sengaja konservatif. Pasal di luar daftar ini tetap sah dipakai
 * sebagai dasar report di dalam sistem, tetapi tidak cukup untuk meneruskan
 * berkas ke Komdigi. Menambah pasal di sini adalah keputusan hukum, bukan
 * keputusan teknis — ubah hanya setelah dicek ke naskah UU yang berlaku.
 */
export const TAKEDOWN_ELIGIBLE_ARTICLES: readonly string[] = [
  '27',
  '27A',
  '27B',
  '28',
  '29',
];

/** Status wajib sebelum report boleh diteruskan (tabel 7.2 baris 18). */
export const REQUIRED_STATUS: ReportStatusValue = 'APPROVED';

/** Panjang minimum kronologi agar surat tidak kosong isi. */
export const MIN_DESCRIPTION_LENGTH = 50;

// ---------------------------------------------------------------- tipe -----

export const EligibilityCode = {
  STATUS_NOT_APPROVED: 'STATUS_NOT_APPROVED',
  ALREADY_FORWARDED: 'ALREADY_FORWARDED',
  NO_LEGAL_BASIS: 'NO_LEGAL_BASIS',
  LEGAL_BASIS_UNVERIFIED: 'LEGAL_BASIS_UNVERIFIED',
  NO_UU_ITE_BASIS: 'NO_UU_ITE_BASIS',
  ARTICLE_NOT_TAKEDOWN_ELIGIBLE: 'ARTICLE_NOT_TAKEDOWN_ELIGIBLE',
  NO_TARGET_URL: 'NO_TARGET_URL',
  TARGET_URL_INVALID: 'TARGET_URL_INVALID',
  NO_CLEAN_EVIDENCE: 'NO_CLEAN_EVIDENCE',
  EVIDENCE_INFECTED: 'EVIDENCE_INFECTED',
  EVIDENCE_SCAN_PENDING: 'EVIDENCE_SCAN_PENDING',
  EVIDENCE_SCAN_ERROR: 'EVIDENCE_SCAN_ERROR',
  DESCRIPTION_TOO_SHORT: 'DESCRIPTION_TOO_SHORT',
  UNUSED_LEGAL_BASIS: 'UNUSED_LEGAL_BASIS',
} as const;

export type EligibilityCodeValue =
  (typeof EligibilityCode)[keyof typeof EligibilityCode];

export type EvidenceScanStatus = 'PENDING' | 'CLEAN' | 'INFECTED' | 'ERROR';

/**
 * Satu baris `report_legal_basis`, sudah diratakan oleh pemanggil.
 *
 * `lawCode` diisi dari relasi paragraph -> article -> version -> law. Bila
 * baris itu dasar bebas (`paragraph_id` kosong), `lawCode` null dan `linked`
 * false — baris seperti itu tidak pernah dihitung sebagai dasar yang sah
 * untuk Komdigi, karena nomor pasalnya tidak dijamin siapa pun.
 */
export interface LegalBasisInput {
  lawCode: string | null;
  articleNumber: string | null;
  paragraphNumber: string | null;
  linked: boolean;
  otherReason?: string | null;
}

export interface EvidenceInput {
  scanStatus: EvidenceScanStatus;
}

export interface EligibilityInput {
  status: ReportStatusValue;
  targetUrl: string | null;
  description: string | null;
  legalBasis: readonly LegalBasisInput[];
  evidences: readonly EvidenceInput[];
  /** Sudah pernah diteruskan ke kanal Komdigi sebelumnya. */
  alreadyForwarded?: boolean;
}

export interface EligibilityFinding {
  code: EligibilityCodeValue;
  message: string;
}

export interface EligibilityResult {
  /** True hanya bila `blockers` kosong. */
  eligible: boolean;
  /** Penghalang keras. Selama ada isinya, penerusan dilarang. */
  blockers: EligibilityFinding[];
  /** Catatan yang perlu dilihat admin tetapi tidak menghalangi. */
  warnings: EligibilityFinding[];
  /** Pasal UU ITE yang lolos saring, untuk dicantumkan di surat. */
  citedArticles: string[];
  cleanEvidenceCount: number;
}

// ------------------------------------------------------------- pembantu ----

/**
 * Menyeragamkan penulisan nomor pasal agar perbandingan tidak meleset karena
 * spasi atau huruf kecil: "Pasal 27 a" dan "27A" dianggap sama.
 */
export function normalizeArticleNumber(value: string | null): string | null {
  if (!value) return null;

  const cleaned = value
    .replace(/pasal/gi, ' ')
    .replace(/[\s.]+/g, '')
    .toUpperCase();

  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Pemeriksaan bentuk URL, bukan pemeriksaan keamanan. Pertahanan SSRF ada di
 * modul fetcher; di sini cukup dipastikan surat tidak memuat alamat kosong
 * atau skema yang tidak bisa dibuka petugas.
 */
export function isPlausibleTargetUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (!parsed.hostname.includes('.')) return false;
  if (parsed.hostname.startsWith('.') || parsed.hostname.endsWith('.')) return false;

  return true;
}

function finding(
  code: EligibilityCodeValue,
  message: string,
): EligibilityFinding {
  return { code, message };
}

// --------------------------------------------------------------- aturan ----

/**
 * Menilai satu report terhadap seluruh syarat penerusan.
 *
 * Fungsi ini tidak melempar exception. Ia selalu mengembalikan hasil lengkap
 * supaya antarmuka admin bisa menampilkan seluruh penghalang sekaligus,
 * bukan satu per satu setiap kali tombol ditekan.
 */
export function evaluateKomdigiEligibility(
  input: EligibilityInput,
): EligibilityResult {
  const blockers: EligibilityFinding[] = [];
  const warnings: EligibilityFinding[] = [];

  // ---- status ----
  if (input.status !== REQUIRED_STATUS) {
    blockers.push(
      finding(
        EligibilityCode.STATUS_NOT_APPROVED,
        `Status report harus ${REQUIRED_STATUS}, saat ini ${input.status}.`,
      ),
    );
  }

  if (input.alreadyForwarded === true) {
    blockers.push(
      finding(
        EligibilityCode.ALREADY_FORWARDED,
        'Report ini sudah pernah diteruskan ke Komdigi.',
      ),
    );
  }

  // ---- dasar hukum ----
  const citedArticles = collectCitedArticles(input.legalBasis, blockers, warnings);

  // ---- URL target ----
  const targetUrl = input.targetUrl?.trim() ?? '';
  if (targetUrl.length === 0) {
    blockers.push(
      finding(
        EligibilityCode.NO_TARGET_URL,
        'URL konten yang dilaporkan belum terisi.',
      ),
    );
  } else if (!isPlausibleTargetUrl(targetUrl)) {
    blockers.push(
      finding(
        EligibilityCode.TARGET_URL_INVALID,
        'URL konten tidak valid; harus berupa tautan http atau https yang utuh.',
      ),
    );
  }

  // ---- bukti ----
  const cleanEvidenceCount = countEvidence(input.evidences, blockers, warnings);

  // ---- kronologi ----
  const description = input.description?.trim() ?? '';
  if (description.length < MIN_DESCRIPTION_LENGTH) {
    blockers.push(
      finding(
        EligibilityCode.DESCRIPTION_TOO_SHORT,
        `Kronologi minimal ${MIN_DESCRIPTION_LENGTH} karakter, saat ini ${description.length}.`,
      ),
    );
  }

  return {
    eligible: blockers.length === 0,
    blockers,
    warnings,
    citedArticles,
    cleanEvidenceCount,
  };
}

/**
 * Menyaring dasar hukum sampai tersisa pasal UU ITE yang boleh dikutip.
 *
 * Tiga saringan berurutan, masing-masing dengan pesan sendiri supaya admin
 * tahu persis apa yang kurang: ada dasarnya atau tidak, dasarnya UU ITE atau
 * bukan, dan pasalnya termasuk yang bisa dimintakan pemutusan akses atau tidak.
 */
function collectCitedArticles(
  legalBasis: readonly LegalBasisInput[],
  blockers: EligibilityFinding[],
  warnings: EligibilityFinding[],
): string[] {
  if (legalBasis.length === 0) {
    blockers.push(
      finding(
        EligibilityCode.NO_LEGAL_BASIS,
        'Report belum memiliki dasar hukum.',
      ),
    );
    return [];
  }

  const linked = legalBasis.filter((basis) => basis.linked);
  if (linked.length === 0) {
    blockers.push(
      finding(
        EligibilityCode.LEGAL_BASIS_UNVERIFIED,
        'Dasar hukum hanya berupa alasan bebas, belum tertaut ke pasal di basis data. ' +
          'Penerusan ke Komdigi menuntut pasal yang terverifikasi.',
      ),
    );
    return [];
  }

  const iteBasis = linked.filter((basis) => basis.lawCode === KOMDIGI_LAW_CODE);
  if (iteBasis.length === 0) {
    blockers.push(
      finding(
        EligibilityCode.NO_UU_ITE_BASIS,
        'Tidak ada dasar hukum UU ITE. Kanal Komdigi hanya menerima aduan ' +
          'konten dengan dasar UU ITE.',
      ),
    );
    return [];
  }

  const eligible: string[] = [];
  const rejected: string[] = [];

  for (const basis of iteBasis) {
    const article = normalizeArticleNumber(basis.articleNumber);
    if (!article) {
      rejected.push('(nomor pasal kosong)');
      continue;
    }

    if (TAKEDOWN_ELIGIBLE_ARTICLES.includes(article)) {
      if (!eligible.includes(article)) eligible.push(article);
    } else if (!rejected.includes(article)) {
      rejected.push(article);
    }
  }

  if (eligible.length === 0) {
    blockers.push(
      finding(
        EligibilityCode.ARTICLE_NOT_TAKEDOWN_ELIGIBLE,
        `Pasal yang dipakai (${rejected.join(', ')}) tidak termasuk pasal ` +
          `muatan yang dilarang UU ITE (${TAKEDOWN_ELIGIBLE_ARTICLES.join(', ')}).`,
      ),
    );
    return [];
  }

  if (rejected.length > 0) {
    warnings.push(
      finding(
        EligibilityCode.UNUSED_LEGAL_BASIS,
        `Dasar hukum ${rejected.join(', ')} tidak akan dicantumkan di surat ` +
          'karena di luar daftar pasal muatan yang dilarang.',
      ),
    );
  }

  const unlinkedCount = legalBasis.length - linked.length;
  if (unlinkedCount > 0) {
    warnings.push(
      finding(
        EligibilityCode.UNUSED_LEGAL_BASIS,
        `${unlinkedCount} alasan bebas tidak akan dicantumkan di surat.`,
      ),
    );
  }

  return eligible;
}

/**
 * Menghitung bukti yang layak dilampirkan.
 *
 * Berkas terinfeksi menghalangi keras: mengirim lampiran bervirus ke alamat
 * instansi adalah kegagalan yang tidak bisa ditarik kembali. Berkas yang
 * belum selesai dipindai hanya menghalangi bila tidak ada satu pun berkas
 * bersih, karena selebihnya cukup ditunda oleh admin.
 */
function countEvidence(
  evidences: readonly EvidenceInput[],
  blockers: EligibilityFinding[],
  warnings: EligibilityFinding[],
): number {
  let clean = 0;
  let pending = 0;
  let infected = 0;
  let errored = 0;

  for (const evidence of evidences) {
    if (evidence.scanStatus === 'CLEAN') clean += 1;
    else if (evidence.scanStatus === 'PENDING') pending += 1;
    else if (evidence.scanStatus === 'INFECTED') infected += 1;
    else errored += 1;
  }

  if (infected > 0) {
    blockers.push(
      finding(
        EligibilityCode.EVIDENCE_INFECTED,
        `${infected} berkas bukti ditandai terinfeksi; hapus berkas tersebut ` +
          'sebelum report diteruskan.',
      ),
    );
  }

  if (clean === 0) {
    blockers.push(
      finding(
        EligibilityCode.NO_CLEAN_EVIDENCE,
        'Tidak ada berkas bukti yang lolos pemindaian.',
      ),
    );
  } else if (pending > 0) {
    warnings.push(
      finding(
        EligibilityCode.EVIDENCE_SCAN_PENDING,
        `${pending} berkas bukti masih dipindai dan tidak akan ikut dilampirkan.`,
      ),
    );
  }

  if (errored > 0) {
    warnings.push(
      finding(
        EligibilityCode.EVIDENCE_SCAN_ERROR,
        `${errored} berkas bukti gagal dipindai dan tidak akan ikut dilampirkan.`,
      ),
    );
  }

  return clean;
}
