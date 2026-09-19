import type { TDocumentDefinitions, Content } from 'pdfmake/interfaces';
import { formatRupiah, formatTaxRate } from '../common/utils/money.util';
import { sanitizeForPdf } from '../common/utils/sanitize.util';

export interface ReportPdfData {
  reportCode: string;
  status: string;
  createdAt: Date;
  generatedAt: Date;
  actionTypeName: string;
  packageQuantity: number;

  targetUrl: string | null;
  canonicalUrl: string | null;
  platformName: string | null;
  targetMetadata: Record<string, string>;
  targetFetchStatus: string;

  unitPrice: bigint | null;
  subtotal: bigint | null;
  taxRateBp: number | null;
  taxAmount: bigint | null;
  totalAmount: bigint | null;
  invoiceNumber: string | null;

  description: string | null;

  policies: Array<{ name: string; version: string | null; text: string | null; otherReason: string | null }>;
  legalBasis: Array<{
    lawName: string;
    lawVersion: string | null;
    articleNumber: string | null;
    paragraphNumber: string | null;
    text: string | null;
    explanation: string | null;
    otherReason: string | null;
  }>;

  evidences: Array<{ fileName: string; fileHash: string; fileSize: number; caption: string | null; createdAt: Date }>;

  statusHistory: Array<{ from: string | null; to: string; occurredAt: Date; reason: string | null }>;

  /** Lampiran opsional bukti pengerjaan (BRD 8.3). */
  proofs: Array<{
    proofType: string;
    reportedAt: Date;
    caption: string | null;
    unitsReported: number | null;
    fileName: string;
    fileHash: string;
    dataUri?: string;
  }>;
}

const COLORS = {
  ink: '#1f2933',
  muted: '#52606d',
  line: '#cbd2d9',
  accent: '#1f4f8b',
};

function formatDateTime(value: Date): string {
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Asia/Jakarta',
  }).format(value);
}

function text(value: string | null | undefined, fallback = '—'): string {
  if (!value || value.trim().length === 0) return fallback;
  return sanitizeForPdf(value);
}

function sectionTitle(title: string): Content {
  return {
    text: title,
    style: 'sectionTitle',
    margin: [0, 18, 0, 8],
  };
}

/**
 * Menyusun dokumen PDF report.
 *
 * Dokumen dibangun dari definisi terstruktur (pdfmake), BUKAN dari merender
 * HTML. Itu keputusan keamanan pada BRD 4.2: tidak ada mesin peramban yang
 * memproses masukan pengguna, sehingga tidak ada jalur SSRF maupun eksekusi
 * skrip lewat pembuatan PDF. Seluruh teks bebas dibersihkan dari karakter
 * kendali dan karakter pembalik arah sebelum dimasukkan.
 */
export function buildReportPdf(data: ReportPdfData): TDocumentDefinitions {
  const content: Content[] = [];

  content.push(
    {
      columns: [
        [
          { text: 'DOKUMEN REPORT', style: 'kicker' },
          { text: data.reportCode, style: 'title' },
        ],
        {
          width: 'auto',
          stack: [
            { text: `Status: ${data.status}`, style: 'metaRight' },
            { text: `Dibuat: ${formatDateTime(data.createdAt)}`, style: 'metaRight' },
            { text: `Dicetak: ${formatDateTime(data.generatedAt)}`, style: 'metaRight' },
          ],
        },
      ],
    },
    {
      canvas: [{ type: 'line', x1: 0, y1: 4, x2: 515, y2: 4, lineWidth: 1, lineColor: COLORS.line }],
      margin: [0, 6, 0, 0],
    },
    {
      text:
        'Dokumen ini mencatat permintaan pelaporan konten. Sistem hanya membuat dan ' +
        'mendokumentasikan laporan; keputusan penurunan konten sepenuhnya berada pada ' +
        'platform terkait.',
      style: 'disclaimer',
      margin: [0, 10, 0, 0],
    },
  );

  // ------------------------------------------------------------------ target
  content.push(sectionTitle('1. Target Pelaporan'));
  content.push({
    table: {
      widths: [110, '*'],
      body: [
        ['Platform', text(data.platformName)],
        ['Jenis tindakan', text(data.actionTypeName)],
        ['URL target', text(data.targetUrl)],
        ['URL kanonik', text(data.canonicalUrl)],
        ['Judul tersimpan', text(data.targetMetadata.title)],
        ['Keterangan tersimpan', text(data.targetMetadata.description)],
        ['Status pengambilan', text(data.targetFetchStatus)],
      ],
    },
    layout: 'lightHorizontalLines',
    style: 'table',
  });

  if (data.description) {
    content.push({ text: 'Keterangan pelapor', style: 'label', margin: [0, 10, 0, 2] });
    content.push({ text: text(data.description), style: 'body' });
  }

  // ------------------------------------------------------------------- harga
  content.push(sectionTitle('2. Rincian Biaya'));
  content.push({
    table: {
      widths: ['*', 110],
      body: [
        [
          { text: `Paket ${data.packageQuantity} unit`, style: 'cell' },
          { text: data.unitPrice ? `${formatRupiah(data.unitPrice)} / unit` : '—', style: 'cellRight' },
        ],
        [
          { text: 'Subtotal', style: 'cell' },
          { text: data.subtotal ? formatRupiah(data.subtotal) : '—', style: 'cellRight' },
        ],
        [
          {
            text: `PPN ${data.taxRateBp !== null ? formatTaxRate(data.taxRateBp) : ''}`.trim(),
            style: 'cell',
          },
          { text: data.taxAmount ? formatRupiah(data.taxAmount) : '—', style: 'cellRight' },
        ],
        [
          { text: 'Total', style: 'cellBold' },
          { text: data.totalAmount ? formatRupiah(data.totalAmount) : '—', style: 'cellBoldRight' },
        ],
      ],
    },
    layout: 'lightHorizontalLines',
    style: 'table',
  });

  if (data.invoiceNumber) {
    content.push({
      text: `Nomor invoice: ${text(data.invoiceNumber)}`,
      style: 'metaSmall',
      margin: [0, 6, 0, 0],
    });
  }

  content.push({
    text: 'Pembayaran yang sudah diterima tidak dapat dikembalikan.',
    style: 'disclaimer',
    margin: [0, 6, 0, 0],
  });

  // ------------------------------------------------------------- kebijakan
  content.push(sectionTitle('3. Kebijakan Platform yang Dilanggar'));
  if (data.policies.length === 0) {
    content.push({ text: 'Tidak ada data.', style: 'body' });
  } else {
    for (const [index, policy] of data.policies.entries()) {
      content.push({
        text: `${index + 1}. ${text(policy.name)}${policy.version ? ` (versi ${text(policy.version)})` : ''}`,
        style: 'label',
        margin: [0, 8, 0, 2],
      });
      if (policy.text) content.push({ text: text(policy.text), style: 'quote' });
      if (policy.otherReason) {
        content.push({ text: `Alasan: ${text(policy.otherReason)}`, style: 'body' });
      }
    }
  }

  // ----------------------------------------------------------- dasar hukum
  content.push(sectionTitle('4. Dasar Hukum'));
  if (data.legalBasis.length === 0) {
    content.push({ text: 'Tidak ada data.', style: 'body' });
  } else {
    for (const [index, legal] of data.legalBasis.entries()) {
      const heading = [
        text(legal.lawName),
        legal.lawVersion ? `versi ${text(legal.lawVersion)}` : null,
        legal.articleNumber ? `Pasal ${text(legal.articleNumber)}` : null,
        legal.paragraphNumber ? `Ayat ${text(legal.paragraphNumber)}` : null,
      ]
        .filter(Boolean)
        .join(' — ');

      content.push({ text: `${index + 1}. ${heading}`, style: 'label', margin: [0, 8, 0, 2] });
      if (legal.text) content.push({ text: text(legal.text), style: 'quote' });
      if (legal.explanation) {
        content.push({ text: `Penjelasan: ${text(legal.explanation)}`, style: 'body' });
      }
      if (legal.otherReason) {
        content.push({ text: `Alasan: ${text(legal.otherReason)}`, style: 'body' });
      }
    }
  }

  // --------------------------------------------------------------- evidence
  content.push(sectionTitle('5. Daftar Evidence'));
  if (data.evidences.length === 0) {
    content.push({ text: 'Tidak ada evidence terlampir.', style: 'body' });
  } else {
    content.push({
      table: {
        widths: ['*', 80, 150],
        headerRows: 1,
        body: [
          [
            { text: 'Nama berkas', style: 'th' },
            { text: 'Ukuran', style: 'th' },
            { text: 'SHA-256 (12 karakter awal)', style: 'th' },
          ],
          ...data.evidences.map((evidence) => [
            { text: text(evidence.fileName), style: 'cell' },
            { text: `${Math.ceil(evidence.fileSize / 1024)} KB`, style: 'cell' },
            { text: evidence.fileHash.slice(0, 12), style: 'cellMono' },
          ]),
        ],
      },
      layout: 'lightHorizontalLines',
      style: 'table',
    });
  }

  // ---------------------------------------------------------- riwayat status
  content.push(sectionTitle('6. Riwayat Status'));
  content.push({
    table: {
      widths: [150, 110, '*'],
      headerRows: 1,
      body: [
        [
          { text: 'Waktu', style: 'th' },
          { text: 'Status', style: 'th' },
          { text: 'Alasan', style: 'th' },
        ],
        ...data.statusHistory.map((entry) => [
          { text: formatDateTime(entry.occurredAt), style: 'cell' },
          { text: `${entry.from ?? '—'} → ${entry.to}`, style: 'cell' },
          { text: text(entry.reason), style: 'cell' },
        ]),
      ],
    },
    layout: 'lightHorizontalLines',
    style: 'table',
  });

  // -------------------------------------------------- lampiran bukti kerja
  if (data.proofs.length > 0) {
    content.push({ text: '', pageBreak: 'before' });
    content.push(sectionTitle('Lampiran — Bukti Pengerjaan'));
    content.push({
      text:
        'Gambar di bawah adalah bukti bahwa permintaan pelaporan sudah dikerjakan. ' +
        'Bukti diunggah oleh admin operasional dan tidak dapat diubah pengguna.',
      style: 'body',
      margin: [0, 0, 0, 8],
    });

    for (const [index, proof] of data.proofs.entries()) {
      content.push({
        text: `${index + 1}. ${text(proof.proofType)} — ${formatDateTime(proof.reportedAt)}`,
        style: 'label',
        margin: [0, 12, 0, 4],
      });

      if (proof.caption) content.push({ text: text(proof.caption), style: 'body' });
      if (proof.unitsReported !== null) {
        content.push({ text: `Unit tercakup: ${proof.unitsReported}`, style: 'metaSmall' });
      }
      content.push({
        text: `Berkas: ${text(proof.fileName)} — SHA-256 ${proof.fileHash.slice(0, 16)}…`,
        style: 'metaSmall',
      });

      if (proof.dataUri) {
        content.push({ image: proof.dataUri, fit: [480, 320], margin: [0, 6, 0, 0] });
      }
    }
  }

  return {
    info: {
      title: `Report ${data.reportCode}`,
      author: 'Sistem Pelaporan Konten Media Sosial',
      subject: 'Dokumen report pelaporan konten',
    },
    pageSize: 'A4',
    pageMargins: [40, 48, 40, 56],
    defaultStyle: { font: 'Helvetica', fontSize: 9.5, color: COLORS.ink, lineHeight: 1.35 },
    content,
    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        { text: data.reportCode, style: 'footer' },
        { text: `Halaman ${currentPage} dari ${pageCount}`, style: 'footer', alignment: 'right' },
      ],
      margin: [40, 12, 40, 0],
    }),
    styles: {
      kicker: { fontSize: 8, color: COLORS.muted, characterSpacing: 1.2 },
      title: { fontSize: 20, bold: true, color: COLORS.accent, margin: [0, 2, 0, 0] },
      metaRight: { fontSize: 8.5, color: COLORS.muted, alignment: 'right' },
      metaSmall: { fontSize: 8.5, color: COLORS.muted },
      sectionTitle: { fontSize: 12, bold: true, color: COLORS.accent },
      label: { fontSize: 10, bold: true },
      body: { fontSize: 9.5 },
      quote: { fontSize: 9, color: COLORS.muted, italics: true, margin: [10, 2, 0, 2] },
      disclaimer: { fontSize: 8.5, color: COLORS.muted, italics: true },
      table: { margin: [0, 4, 0, 0], fontSize: 9 },
      th: { bold: true, fontSize: 9, color: COLORS.muted },
      cell: { fontSize: 9 },
      cellRight: { fontSize: 9, alignment: 'right' },
      cellBold: { fontSize: 10, bold: true },
      cellBoldRight: { fontSize: 10, bold: true, alignment: 'right' },
      cellMono: { fontSize: 8.5, font: 'Courier' },
      footer: { fontSize: 8, color: COLORS.muted },
    },
  };
}
