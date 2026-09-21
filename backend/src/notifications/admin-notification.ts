/**
 * Penyusun isi notifikasi admin — teks yang dikirim ke kanal luar (Telegram
 * atau WhatsApp) ketika sebuah report membutuhkan perhatian admin.
 *
 * Berkas ini sengaja tidak mengimpor apa pun: tidak Prisma, tidak Nest, tidak
 * pustaka HTTP. Dengan begitu seluruh aturan pemotongan, pembersihan, dan
 * penyamaran nomor dapat diuji tanpa database maupun jaringan, sama seperti
 * `state-machine.ts` dan `komdigi-eligibility.ts`.
 *
 * Perbedaannya dengan payload outbox (`OutboxPayload`) disengaja dan penting.
 * Payload outbox dikirim ke zona Automation yang berada di luar kendali
 * sistem, jadi isinya minimal — tanpa URL target, tanpa kutipan, tanpa nama.
 * Pesan yang disusun di sini TIDAK melewati zona itu: ia dibangun di worker,
 * yang membaca langsung dari basis data, lalu diserahkan ke kanal tujuan.
 * Karena itu isinya boleh lebih kaya, tetapi tetap dibatasi oleh dua aturan di
 * bawah.
 *
 * Aturan pertama: identitas pelapor tidak pernah ikut. Nama, email, dan nomor
 * telepon pelapor tidak punya tempat di pesan yang berakhir di galeri ponsel
 * dan cadangan awan milik orang lain.
 *
 * Aturan kedua: kutipan kronologi dipotong. Kronologi ditulis bebas oleh
 * pelapor dan kerap memuat nama pihak ketiga, tangkapan percakapan, dan
 * rincian pribadi. Yang dikirim hanya pembuka secukupnya untuk menilai
 * prioritas; sisanya dibaca admin di panel, tempat aksesnya tercatat.
 */

// ------------------------------------------------------------- konstanta ---

/** Panjang bawaan kutipan kronologi. */
export const DEFAULT_EXCERPT_LENGTH = 200;

/** Batas keras kutipan, berapa pun yang diminta lewat konfigurasi. */
export const MAX_EXCERPT_LENGTH = 400;

/**
 * Batas panjang satu parameter template WhatsApp.
 *
 * Meta menolak parameter yang terlalu panjang, dan penolakan itu baru terjadi
 * setelah permintaan dikirim. Memotong lebih dulu membuat kegagalan mustahil
 * alih-alih membuat kegagalan yang harus ditangani.
 */
export const MAX_PARAMETER_LENGTH = 1024;

// ----------------------------------------------------------- bentuk data ---

export interface AdminNotificationInput {
  reportCode: string;
  status: string;
  /** URL postingan atau akun yang dilaporkan; null bila snapshot gagal. */
  targetUrl: string | null;
  platformName: string | null;
  actionTypeName: string | null;
  /** Label kebijakan platform yang dipilih pelapor. */
  policyLabels: readonly string[];
  /** Label pasal, mis. "UU ITE Pasal 27A ayat (1)". */
  articleLabels: readonly string[];
  /** Kronologi mentah dari pelapor. */
  description: string | null;
  /**
   * Jumlah unit pada paket yang dibeli, mis. 300, 500, 1000.
   *
   * Diambil dari snapshot di baris report, bukan dari tabel paket. Paket dapat
   * diubah admin kapan saja; yang berlaku bagi satu report adalah angka yang
   * dibekukan saat pembayaran dimulai.
   */
  packageQuantity: number | null;
  evidenceCount: number;
  /** Tautan ke panel admin; selalu menuntut login. */
  adminLink: string;
  occurredAt: Date;
  excerptLength?: number;
}

export interface AdminNotification {
  /** Bentuk satu blok teks, untuk kanal yang menerima teks bebas. */
  text: string;
  /**
   * Bentuk parameter berurutan, untuk kanal yang menuntut template.
   *
   * Urutannya tetap dan menjadi kontrak dengan template yang didaftarkan di
   * Meta: {{1}} kode report, {{2}} ringkasan pelanggaran, {{3}} URL target,
   * {{4}} kutipan kronologi, {{5}} tautan panel admin, {{6}} paket.
   *
   * Menambah parameter di TENGAH urutan akan menggeser arti parameter
   * sesudahnya pada template yang sudah disetujui Meta, dan pesan akan
   * terkirim dengan isi yang tertukar tanpa satu pun galat. Parameter baru
   * selalu ditambahkan di akhir, kecuali templatenya memang didaftarkan ulang.
   */
  parameters: string[];
}

// -------------------------------------------------------------- utilitas ---

/**
 * Merapikan teks bebas menjadi satu baris.
 *
 * Baris baru, tab, dan spasi beruntun diganti satu spasi. Dua kanal tujuan
 * menuntut ini: parameter template WhatsApp menolak baris baru, dan teks
 * Telegram yang memuat baris baru dari pelapor akan merusak tata letak pesan.
 */
export function flattenWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Memotong teks pada batas kata.
 *
 * Memotong di tengah kata membuat kutipan terbaca seperti data rusak, dan
 * pada kasus terburuk memenggal sebuah nama menjadi potongan yang menyesatkan.
 * Bila tidak ada spasi yang layak di dekat batas, pemotongan keras dipakai
 * sebagai jalan terakhir.
 */
export function truncateAtWord(value: string, maxLength: number): string {
  if (maxLength <= 0) return '';
  if (value.length <= maxLength) return value;

  const hard = value.slice(0, maxLength);
  const lastSpace = hard.lastIndexOf(' ');

  // Ambang setengah panjang: bila spasi terakhir terlalu jauh ke depan,
  // memotong di sana membuang terlalu banyak isi.
  const cut = lastSpace >= Math.floor(maxLength / 2) ? hard.slice(0, lastSpace) : hard;

  return `${cut.trimEnd()}…`;
}

/**
 * Kutipan kronologi yang siap dikirim.
 *
 * Mengembalikan string kosong bila pelapor tidak menulis apa pun; pemanggil
 * yang memutuskan cara menampilkan ketiadaan itu.
 */
export function buildExcerpt(
  description: string | null,
  excerptLength: number = DEFAULT_EXCERPT_LENGTH,
): string {
  if (!description) return '';

  const limit = Math.min(Math.max(excerptLength, 0), MAX_EXCERPT_LENGTH);
  return truncateAtWord(flattenWhitespace(description), limit);
}

/**
 * Menyamarkan tujuan untuk keperluan log.
 *
 * Nomor WhatsApp dan chat id Telegram adalah pengenal yang menunjuk orang
 * nyata. Log dibaca lebih banyak mata daripada basis data, dan sering ikut
 * terkirim saat seseorang menempelkan keluaran terminal untuk meminta bantuan.
 * Empat karakter terakhir cukup untuk memastikan tujuan benar tanpa
 * menuliskan pengenal utuh.
 */
export function maskDestination(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 4) return '*'.repeat(trimmed.length);

  const head = trimmed.startsWith('+') ? 3 : 2;
  if (trimmed.length <= head + 4) return `${trimmed.slice(0, head)}****`;

  const tail = trimmed.slice(-4);
  const stars = '*'.repeat(Math.max(trimmed.length - head - 4, 1));
  return `${trimmed.slice(0, head)}${stars}${tail}`;
}

/**
 * Ringkasan dugaan pelanggaran.
 *
 * Kebijakan platform dan pasal digabung karena keduanya menjawab pertanyaan
 * yang sama bagi admin: atas dasar apa report ini masuk. Dipisahkan dengan
 * titik koma agar tetap terbaca ketika salah satunya kosong.
 */
export function summarizeGrounds(
  policyLabels: readonly string[],
  articleLabels: readonly string[],
): string {
  const parts = [...policyLabels, ...articleLabels]
    .map((label) => flattenWhitespace(label))
    .filter((label) => label.length > 0);

  return parts.length > 0 ? parts.join('; ') : 'Tidak dirinci';
}

/**
 * Ukuran paket yang dibeli pelapor.
 *
 * Angkanya diberi pemisah ribuan karena inilah satu-satunya bilangan besar di
 * dalam pesan: "1.000 laporan" terbaca sekali lihat, "1000 laporan" menuntut
 * admin menghitung digit. Nilai kosong ditandai dengan jelas alih-alih
 * ditampilkan sebagai nol, yang akan terbaca seolah paketnya memang nol unit.
 */
export function formatPackage(quantity: number | null): string {
  if (quantity === null || !Number.isFinite(quantity)) return 'tidak tercatat';
  return `${new Intl.NumberFormat('id-ID').format(quantity)} laporan`;
}

/** Waktu setempat, karena admin yang membacanya berada di Indonesia. */
export function formatJakartaTime(value: Date): string {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(value);
}

// --------------------------------------------------------------- penyusun --

/** Memastikan satu parameter tidak melewati batas yang diterima Meta. */
function clampParameter(value: string): string {
  const flat = flattenWhitespace(value);
  return flat.length > MAX_PARAMETER_LENGTH
    ? truncateAtWord(flat, MAX_PARAMETER_LENGTH)
    : flat;
}

/**
 * Menyusun pesan notifikasi admin dalam dua bentuk sekaligus.
 *
 * Satu sumber, dua bentuk, supaya isi yang dibaca admin tidak berbeda antara
 * kanal Telegram dan kanal WhatsApp. Perbedaan isi antar kanal adalah jenis
 * cacat yang baru ketahuan berbulan-bulan kemudian, saat seseorang
 * membandingkan dua ponsel.
 */
export function buildAdminNotification(input: AdminNotificationInput): AdminNotification {
  const grounds = summarizeGrounds(input.policyLabels, input.articleLabels);
  const excerpt = buildExcerpt(input.description, input.excerptLength);
  const target = input.targetUrl ?? 'Tidak tersedia';

  const jenis = [input.actionTypeName, input.platformName]
    .filter((value): value is string => Boolean(value))
    .join(' · ');

  const paket = formatPackage(input.packageQuantity);

  const lines = [
    `Report baru: ${input.reportCode}`,
    `Status: ${input.status}`,
    jenis ? `Jenis: ${jenis}` : null,
    `Paket: ${paket}`,
    `Dasar: ${grounds}`,
    `Target: ${target}`,
    excerpt ? `Kronologi: ${excerpt}` : 'Kronologi: tidak diisi',
    `Bukti: ${input.evidenceCount} berkas`,
    `Masuk: ${formatJakartaTime(input.occurredAt)}`,
    `Panel: ${input.adminLink}`,
  ].filter((line): line is string => line !== null);

  return {
    text: lines.join('\n'),
    parameters: [
      clampParameter(input.reportCode),
      clampParameter(grounds),
      clampParameter(target),
      clampParameter(excerpt || 'tidak diisi'),
      clampParameter(input.adminLink),
      clampParameter(paket),
    ],
  };
}
