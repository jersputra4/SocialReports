/**
 * Penerjemah antara baris database dan dua modul murni di jalur Komdigi:
 * gate kelayakan dan pembangun surat.
 *
 * Keduanya sengaja tidak mengenal Prisma. Berkas ini yang menjembatani, dan
 * ia juga tidak mengimpor Prisma — bentuk masukannya dituliskan sebagai
 * antarmuka lokal yang kebetulan cocok dengan hasil query. Akibatnya seluruh
 * pemetaan dapat diuji tanpa database, dan kesalahan pemetaan terlihat di
 * unit test, bukan saat surat sudah terkirim ke instansi.
 */

import type { EligibilityInput, EvidenceScanStatus } from './komdigi-eligibility';
import type { KomdigiLetterData } from '../documents/komdigi-letter.builder';

// ------------------------------------------------------- bentuk masukan ----

export interface LegalBasisRow {
  /** Terisi bila dasar hukum tertaut ke pasal nyata di basis data. */
  paragraphId: string | null;
  lawNameSnapshot: string;
  lawVersionSnapshot: string | null;
  articleNumberSnapshot: string | null;
  paragraphNumberSnapshot: string | null;
  textSnapshot: string | null;
  otherReason: string | null;
  /** Rantai relasi paragraph → article → legalVersion → law. */
  paragraph?: {
    article: { legalVersion: { law: { code: string } } };
  } | null;
}

export interface EvidenceRow {
  fileName: string;
  fileHash: string;
  fileSize: number;
  caption: string | null;
  createdAt: Date;
  scanStatus: string;
  storagePath: string;
  fileType: string;
}

export interface ReportRow {
  reportCode: string;
  status: string;
  description: string | null;
  user: { fullName: string; email: string };
  actionType: { name: string } | null;
  platformNameSnapshot: string | null;
  targetSnapshot: {
    originalUrl: string;
    canonicalUrl: string | null;
  } | null;
  legalBasis: LegalBasisRow[];
  evidences: EvidenceRow[];
}

export interface SenderIdentity {
  organizationName: string;
  address: string | null;
  email: string;
  phone: string | null;
}

// ------------------------------------------------------------ nomor surat --

export const ROMAN_MONTHS = [
  'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII',
] as const;

/**
 * Nomor surat keluar.
 *
 * Polanya `<percobaan>/<kode report>/KOMDIGI/<bulan romawi>/<tahun>`, mengikuti
 * kebiasaan penomoran surat resmi Indonesia. Nomor dibangun dari data yang
 * sudah ada — kode report dan nomor percobaan — bukan dari sequence database,
 * sehingga satu surat selalu punya nomor yang sama bila dibangun ulang dan
 * tidak ada nomor yang terbakar ketika pengiriman gagal.
 *
 * Bila nanti dibutuhkan nomor urut tunggal lintas report, ganti fungsi ini
 * dengan pembacaan sequence; pemanggilnya tidak perlu berubah.
 */
export function formatKomdigiLetterNumber(input: {
  reportCode: string;
  attempt: number;
  date: Date;
}): string {
  const jakarta = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
  }).format(input.date);

  const [year, month] = jakarta.split('-');
  const roman = ROMAN_MONTHS[Number.parseInt(month, 10) - 1];
  const attempt = String(Math.max(1, input.attempt)).padStart(3, '0');

  return `${attempt}/${input.reportCode}/KOMDIGI/${roman}/${year}`;
}

// ---------------------------------------------------------- pemetaan -------

/** Kode hukum dari rantai relasi; null bila dasar hukum berupa alasan bebas. */
export function lawCodeOf(basis: LegalBasisRow): string | null {
  return basis.paragraph?.article.legalVersion.law.code ?? null;
}

/**
 * URL yang dipakai untuk penilaian dan untuk surat.
 *
 * URL kanonik lebih disukai karena sudah dinormalkan, tetapi tidak selalu ada
 * — pengambilan metadata boleh gagal tanpa menggagalkan report (BRD 4.2).
 */
export function resolveTargetUrl(report: ReportRow): string | null {
  const snapshot = report.targetSnapshot;
  if (!snapshot) return null;
  return snapshot.canonicalUrl ?? snapshot.originalUrl ?? null;
}

export function toEligibilityInput(
  report: ReportRow,
  alreadyForwarded = false,
): EligibilityInput {
  return {
    status: report.status as EligibilityInput['status'],
    targetUrl: resolveTargetUrl(report),
    description: report.description,
    alreadyForwarded,
    legalBasis: report.legalBasis.map((basis) => ({
      lawCode: lawCodeOf(basis),
      articleNumber: basis.articleNumberSnapshot,
      paragraphNumber: basis.paragraphNumberSnapshot,
      linked: basis.paragraphId !== null,
      otherReason: basis.otherReason,
    })),
    evidences: report.evidences.map((evidence) => ({
      scanStatus: evidence.scanStatus as EvidenceScanStatus,
    })),
  };
}

/** Bukti yang boleh ikut dilampirkan: hanya yang lolos pemindaian. */
export function attachableEvidences(report: ReportRow): EvidenceRow[] {
  return report.evidences.filter((evidence) => evidence.scanStatus === 'CLEAN');
}

/**
 * Menyusun isi surat.
 *
 * `citedArticles` berasal dari hasil gate, bukan dari seluruh dasar hukum
 * report. Itu disengaja: surat hanya mengutip pasal yang memang dapat menjadi
 * dasar permohonan, sehingga dasar hukum lain yang dipakai internal tidak ikut
 * terkirim ke instansi.
 */
export function toLetterData(input: {
  report: ReportRow;
  sender: SenderIdentity;
  letterNumber: string;
  letterDate: Date;
  citedArticles: readonly string[];
  generatedAt: Date;
}): KomdigiLetterData {
  const { report } = input;
  const cited = new Set(input.citedArticles.map((article) => article.toUpperCase()));

  const legalBasis = report.legalBasis
    .filter((basis) => basis.paragraphId !== null)
    .filter((basis) => {
      const article = basis.articleNumberSnapshot?.replace(/\s+/g, '').toUpperCase();
      return article !== undefined && cited.has(article);
    })
    .map((basis) => ({
      lawName: basis.lawNameSnapshot,
      lawVersion: basis.lawVersionSnapshot,
      articleNumber: basis.articleNumberSnapshot,
      paragraphNumber: basis.paragraphNumberSnapshot,
      text: basis.textSnapshot,
    }));

  return {
    letterNumber: input.letterNumber,
    letterDate: input.letterDate,
    reportCode: report.reportCode,
    sender: input.sender,
    reporter: {
      fullName: report.user.fullName,
      email: report.user.email,
    },
    target: {
      // Gate menjamin URL tidak kosong sebelum surat dibangun.
      url: resolveTargetUrl(report) ?? '',
      canonicalUrl: report.targetSnapshot?.canonicalUrl ?? null,
      platformName: report.platformNameSnapshot,
      actionTypeName: report.actionType?.name ?? null,
    },
    legalBasis,
    chronology: report.description ?? '',
    evidences: attachableEvidences(report).map((evidence) => ({
      fileName: evidence.fileName,
      fileHash: evidence.fileHash,
      fileSize: evidence.fileSize,
      caption: evidence.caption,
      createdAt: evidence.createdAt,
    })),
    generatedAt: input.generatedAt,
  };
}
