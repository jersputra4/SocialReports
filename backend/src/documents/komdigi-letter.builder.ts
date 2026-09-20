import type { TDocumentDefinitions, Content } from 'pdfmake/interfaces';
import { sanitizeForPdf } from '../common/utils/sanitize.util';

/**
 * Surat permohonan pemutusan akses konten ke Komdigi.
 *
 * Berbeda dari `report-pdf.builder.ts`, yang merupakan dokumen internal untuk
 * pelanggan. Berkas ini menghasilkan surat resmi yang keluar dari sistem dan
 * dibaca petugas instansi, jadi tiga hal dipegang ketat.
 *
 * Pertama, bahasanya menduga, bukan memutus. Surat ini menyatakan konten
 * "diduga melanggar" dan memohon penilaian; ia tidak menyatakan pelanggaran
 * sebagai fakta dan tidak memerintahkan pemutusan akses. Kewenangan itu ada
 * pada pemerintah, bukan pada pelapor.
 *
 * Kedua, setiap klaim dapat ditelusuri. Pasal dikutip dari snapshot yang
 * dibekukan saat report dibuat, dan tiap bukti dicantumkan lengkap dengan
 * SHA-256 sehingga penerima dapat memastikan lampiran tidak berubah.
 *
 * Ketiga, dokumen dibangun dari definisi terstruktur pdfmake, bukan dari
 * merender HTML — alasan keamanan yang sama dengan dokumen report.
 */

const COLORS = {
  ink: '#1f2933',
  muted: '#52606d',
  line: '#cbd2d9',
};

export interface KomdigiLetterData {
  /** Nomor surat keluar, mis. "007/SRS-KOMDIGI/IX/2026". */
  letterNumber: string;
  letterDate: Date;
  reportCode: string;

  /** Identitas penyelenggara sistem yang mengirim surat. */
  sender: {
    organizationName: string;
    address: string | null;
    email: string;
    phone: string | null;
  };

  /**
   * Identitas pelapor. Aduan tanpa pelapor yang dapat dihubungi tidak dapat
   * ditindaklanjuti, jadi bagian ini wajib ada di surat resmi — berbeda dari
   * payload notifikasi yang sengaja tidak memuat identitas (BRD 4.4).
   */
  reporter: {
    fullName: string;
    email: string;
  };

  target: {
    url: string;
    canonicalUrl: string | null;
    platformName: string | null;
    actionTypeName: string | null;
  };

  /** Dasar hukum yang lolos gate kelayakan; urut sesuai nomor pasal. */
  legalBasis: Array<{
    lawName: string;
    lawVersion: string | null;
    articleNumber: string | null;
    paragraphNumber: string | null;
    text: string | null;
  }>;

  /** Kronologi dari pelapor. */
  chronology: string;

  evidences: Array<{
    fileName: string;
    fileHash: string;
    fileSize: number;
    caption: string | null;
    createdAt: Date;
  }>;

  generatedAt: Date;
}

// ------------------------------------------------------------- pembantu ----

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'long',
    timeZone: 'Asia/Jakarta',
  }).format(value);
}

function formatDateTime(value: Date): string {
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Asia/Jakarta',
  }).format(value);
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function text(value: string | null | undefined, fallback = '—'): string {
  if (!value || value.trim().length === 0) return fallback;
  return sanitizeForPdf(value);
}

/** "Pasal 27A ayat (1)" dari potongan snapshot yang tersedia. */
export function formatArticleReference(basis: {
  articleNumber: string | null;
  paragraphNumber: string | null;
}): string {
  const parts: string[] = [];
  if (basis.articleNumber) parts.push(`Pasal ${basis.articleNumber.trim()}`);
  if (basis.paragraphNumber) parts.push(`ayat ${basis.paragraphNumber.trim()}`);
  return parts.length > 0 ? parts.join(' ') : 'Pasal tidak tercantum';
}

function sectionTitle(title: string): Content {
  return { text: title, style: 'sectionTitle', margin: [0, 16, 0, 6] };
}

// --------------------------------------------------------------- dokumen ---

export function buildKomdigiLetter(data: KomdigiLetterData): TDocumentDefinitions {
  const content: Content[] = [];

  // ---- kepala surat ----
  content.push(
    {
      columns: [
        [
          { text: sanitizeForPdf(data.sender.organizationName), style: 'senderName' },
          { text: text(data.sender.address), style: 'senderMeta' },
          { text: `Surel: ${text(data.sender.email)}`, style: 'senderMeta' },
          { text: `Telepon: ${text(data.sender.phone)}`, style: 'senderMeta' },
        ],
        {
          width: 'auto',
          stack: [{ text: formatDate(data.letterDate), style: 'metaRight' }],
        },
      ],
    },
    {
      canvas: [{ type: 'line', x1: 0, y1: 6, x2: 515, y2: 6, lineWidth: 1, lineColor: COLORS.line }],
      margin: [0, 8, 0, 12],
    },
    {
      table: {
        widths: [70, '*'],
        body: [
          ['Nomor', text(data.letterNumber)],
          ['Lampiran', `${data.evidences.length} berkas bukti`],
          ['Perihal', 'Permohonan Penilaian dan Penanganan Konten yang Diduga Melanggar UU ITE'],
        ],
      },
      layout: 'noBorders',
      style: 'headTable',
    },
  );

  // ---- tujuan ----
  content.push({
    stack: [
      { text: 'Kepada Yth.', style: 'body', margin: [0, 16, 0, 0] },
      { text: 'Kementerian Komunikasi dan Digital Republik Indonesia', style: 'label' },
      { text: 'u.p. Unit Pengaduan Konten', style: 'body' },
      { text: 'di tempat', style: 'body', margin: [0, 2, 0, 0] },
    ],
  });

  // ---- pembuka ----
  content.push({
    text:
      'Dengan hormat,\n\n' +
      'Bersama surat ini kami menyampaikan aduan atas konten elektronik yang diuraikan ' +
      'di bawah ini. Pelapor menilai konten tersebut diduga melanggar ketentuan ' +
      'Undang-Undang Informasi dan Transaksi Elektronik. Kami memohon Bapak/Ibu berkenan ' +
      'menilai aduan ini dan mengambil langkah yang dipandang perlu sesuai kewenangan ' +
      'yang diatur peraturan perundang-undangan.',
    style: 'body',
    margin: [0, 14, 0, 0],
  });

  // ---- I. pelapor ----
  content.push(sectionTitle('I. Identitas Pelapor'));
  content.push({
    table: {
      widths: [130, '*'],
      body: [
        ['Nama pelapor', text(data.reporter.fullName)],
        ['Surel pelapor', text(data.reporter.email)],
        ['Nomor acuan aduan', text(data.reportCode)],
        ['Disampaikan melalui', sanitizeForPdf(data.sender.organizationName)],
      ],
    },
    layout: 'lightHorizontalLines',
    style: 'table',
  });

  // ---- II. objek ----
  content.push(sectionTitle('II. Objek yang Diadukan'));
  content.push({
    table: {
      widths: [130, '*'],
      body: [
        ['Platform', text(data.target.platformName)],
        ['Jenis objek', text(data.target.actionTypeName)],
        ['Tautan', text(data.target.url)],
        ['Tautan kanonik', text(data.target.canonicalUrl)],
      ],
    },
    layout: 'lightHorizontalLines',
    style: 'table',
  });

  // ---- III. dasar hukum ----
  content.push(sectionTitle('III. Dasar Hukum yang Diduga Dilanggar'));
  if (data.legalBasis.length === 0) {
    content.push({ text: 'Tidak ada dasar hukum yang tercantum.', style: 'body' });
  } else {
    for (const [index, basis] of data.legalBasis.entries()) {
      const heading = [
        `${index + 1}. ${formatArticleReference(basis)}`,
        text(basis.lawName, ''),
        basis.lawVersion ? `(${sanitizeForPdf(basis.lawVersion)})` : '',
      ]
        .filter((part) => part.length > 0)
        .join(' — ');

      content.push({ text: heading, style: 'label', margin: [0, 8, 0, 2] });
      if (basis.text) {
        content.push({ text: `"${text(basis.text)}"`, style: 'quote' });
      }
    }
  }

  // ---- IV. kronologi ----
  content.push(sectionTitle('IV. Uraian Kejadian'));
  content.push({ text: text(data.chronology), style: 'body' });

  // ---- V. bukti ----
  content.push(sectionTitle('V. Daftar Bukti Terlampir'));
  if (data.evidences.length === 0) {
    content.push({ text: 'Tidak ada bukti terlampir.', style: 'body' });
  } else {
    content.push({
      table: {
        widths: [18, '*', 60, 70],
        headerRows: 1,
        body: [
          [
            { text: 'No', style: 'th' },
            { text: 'Nama berkas dan keterangan', style: 'th' },
            { text: 'Ukuran', style: 'th' },
            { text: 'Diunggah', style: 'th' },
          ],
          ...data.evidences.map((evidence, index) => [
            { text: String(index + 1), style: 'cell' },
            {
              stack: [
                { text: text(evidence.fileName), style: 'cell' },
                evidence.caption
                  ? { text: text(evidence.caption), style: 'metaSmall' }
                  : { text: '', style: 'metaSmall' },
                { text: `SHA-256: ${sanitizeForPdf(evidence.fileHash)}`, style: 'cellMono' },
              ],
            },
            { text: formatBytes(evidence.fileSize), style: 'cell' },
            { text: formatDate(evidence.createdAt), style: 'cell' },
          ]),
        ],
      },
      layout: 'lightHorizontalLines',
      style: 'table',
    });

    content.push({
      text:
        'Nilai SHA-256 di atas dapat dipakai untuk memastikan berkas lampiran tidak ' +
        'berubah sejak aduan ini dibuat.',
      style: 'disclaimer',
      margin: [0, 6, 0, 0],
    });
  }

  // ---- penutup ----
  content.push({
    text:
      'Demikian aduan ini kami sampaikan. Kami menyadari bahwa penilaian atas dugaan ' +
      'pelanggaran dan keputusan atas penanganan konten sepenuhnya merupakan kewenangan ' +
      'Kementerian. Kami siap melengkapi keterangan apabila diperlukan.',
    style: 'body',
    margin: [0, 18, 0, 0],
  });

  content.push({
    stack: [
      { text: 'Hormat kami,', style: 'body' },
      { text: sanitizeForPdf(data.sender.organizationName), style: 'label', margin: [0, 36, 0, 0] },
      { text: `Surel: ${text(data.sender.email)}`, style: 'metaSmall' },
    ],
    margin: [0, 20, 0, 0],
  });

  return {
    info: {
      title: `Aduan Konten ${data.reportCode}`,
      author: data.sender.organizationName,
      subject: 'Permohonan penilaian konten yang diduga melanggar UU ITE',
    },
    pageSize: 'A4',
    pageMargins: [50, 50, 50, 60],
    defaultStyle: { font: 'Helvetica', fontSize: 10, color: COLORS.ink, lineHeight: 1.4 },
    content,
    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        { text: `${data.letterNumber} — ${data.reportCode}`, style: 'footer' },
        { text: `Halaman ${currentPage} dari ${pageCount}`, style: 'footer', alignment: 'right' },
      ],
      margin: [50, 14, 50, 0],
    }),
    styles: {
      senderName: { fontSize: 13, bold: true },
      senderMeta: { fontSize: 8.5, color: COLORS.muted },
      metaRight: { fontSize: 9.5, alignment: 'right' },
      metaSmall: { fontSize: 8.5, color: COLORS.muted },
      headTable: { fontSize: 9.5, margin: [0, 0, 0, 0] },
      sectionTitle: { fontSize: 11.5, bold: true },
      label: { fontSize: 10, bold: true },
      body: { fontSize: 10, alignment: 'justify' },
      quote: { fontSize: 9, color: COLORS.muted, italics: true, margin: [12, 2, 0, 2] },
      disclaimer: { fontSize: 8.5, color: COLORS.muted, italics: true },
      table: { margin: [0, 4, 0, 0], fontSize: 9.5 },
      th: { bold: true, fontSize: 9, color: COLORS.muted },
      cell: { fontSize: 9 },
      cellMono: { fontSize: 7.5, font: 'Courier', color: COLORS.muted },
      footer: { fontSize: 8, color: COLORS.muted },
    },
  };
}

/**
 * Meratakan seluruh teks dokumen menjadi satu string.
 *
 * Dipakai unit test dan pemeriksaan sebelum kirim: memastikan surat memuat
 * pasal yang benar dan tidak memuat frasa yang menjanjikan pemutusan akses.
 * Diekspor karena tahap pengiriman perlu memeriksa hal yang sama.
 */
export function flattenLetterText(node: unknown): string {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flattenLetterText).join('\n');

  if (typeof node === 'object') {
    const record = node as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of ['text', 'stack', 'columns', 'content', 'body', 'table']) {
      if (key in record) parts.push(flattenLetterText(record[key]));
    }
    return parts.filter((part) => part.length > 0).join('\n');
  }

  return '';
}
