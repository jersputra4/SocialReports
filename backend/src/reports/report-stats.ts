/**
 * Perhitungan angka dasbor admin.
 *
 * Seperti `state-machine.ts` dan `komdigi-eligibility.ts`, berkas ini tidak
 * mengimpor apa pun. Seluruh aritmetika waktu dan pembulatannya dapat diuji
 * tanpa basis data, dan itu penting: kesalahan pada perhitungan umur antrean
 * tidak menimbulkan galat apa pun — ia hanya menampilkan angka yang salah,
 * dan angka salah yang terlihat meyakinkan lebih berbahaya daripada halaman
 * yang gagal dimuat.
 */

/** Satu laporan yang sedang menunggu tinjauan. */
export interface WaitingItem {
  /** Sejak kapan laporan ini menunggu. */
  waitingSince: Date;
}

export interface QueueAge {
  /** Jumlah laporan dalam antrean. */
  count: number;
  /** Umur rata-rata dalam detik; nol bila antrean kosong. */
  averageSeconds: number;
  /** Umur laporan yang paling lama menunggu; nol bila antrean kosong. */
  oldestSeconds: number;
}

// ------------------------------------------------------------------ waktu --

const MENIT = 60;
const JAM = 60 * MENIT;
const HARI = 24 * JAM;

/**
 * Umur antrean tinjau.
 *
 * Antrean kosong mengembalikan nol, bukan NaN. Pembagian dengan nol adalah
 * cara paling umum sebuah dasbor menampilkan "NaN menit" kepada penggunanya.
 *
 * Nilai negatif — akibat jam peladen yang mundur, atau baris dengan waktu di
 * masa depan — dijepit ke nol. Laporan tidak mungkin menunggu selama waktu
 * negatif, dan menampilkannya hanya membingungkan.
 */
export function calculateQueueAge(items: readonly WaitingItem[], now: Date): QueueAge {
  if (items.length === 0) {
    return { count: 0, averageSeconds: 0, oldestSeconds: 0 };
  }

  const umur = items.map((item) =>
    Math.max(0, Math.floor((now.getTime() - item.waitingSince.getTime()) / 1000)),
  );

  const total = umur.reduce((jumlah, nilai) => jumlah + nilai, 0);

  return {
    count: items.length,
    averageSeconds: Math.round(total / items.length),
    oldestSeconds: Math.max(...umur),
  };
}

/**
 * Durasi dalam bahasa Indonesia, dibulatkan ke satuan yang masuk akal.
 *
 * Admin tidak perlu tahu antrean tertua berumur 93.847 detik. Yang ia perlu
 * tahu adalah "1 hari". Ketelitian yang tidak dipakai hanya menambah beban
 * baca.
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'kurang dari 1 menit';

  if (seconds < MENIT) return 'kurang dari 1 menit';
  if (seconds < JAM) {
    const menit = Math.floor(seconds / MENIT);
    return `${menit} menit`;
  }
  if (seconds < HARI) {
    const jam = Math.floor(seconds / JAM);
    return `${jam} jam`;
  }

  const hari = Math.floor(seconds / HARI);
  return `${hari} hari`;
}

/**
 * Awal bulan berjalan menurut waktu Jakarta.
 *
 * Peladen berjalan dengan jam UTC, sementara admin yang membaca dasbor berada
 * di WIB. Tanpa penyesuaian ini, setiap tanggal 1 antara pukul 00:00 dan 07:00
 * WIB, dasbor masih menghitung bulan sebelumnya — kesalahan yang hanya muncul
 * tujuh jam setiap bulan dan hampir mustahil ditemukan tanpa sengaja.
 */
export function startOfMonthJakarta(now: Date): Date {
  const bagian = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
  }).format(now);

  const [tahun, bulan] = bagian.split('-');

  // WIB adalah UTC+7, tanpa daylight saving, jadi awal bulan di Jakarta sama
  // dengan pukul 17:00 UTC pada hari terakhir bulan sebelumnya.
  return new Date(`${tahun}-${bulan}-01T00:00:00+07:00`);
}

// --------------------------------------------------------------- hitungan --

/**
 * Melengkapi hasil `groupBy` dengan status yang jumlahnya nol.
 *
 * Basis data hanya mengembalikan baris yang ada. Dasbor perlu seluruh status,
 * termasuk yang kosong, supaya tata letaknya tidak berubah-ubah setiap kali
 * satu laporan berpindah status.
 */
export function fillStatusCounts(
  rows: readonly { status: string; count: number }[],
  allStatuses: readonly string[],
): Record<string, number> {
  const hasil: Record<string, number> = {};
  for (const status of allStatuses) hasil[status] = 0;
  for (const row of rows) hasil[row.status] = row.count;
  return hasil;
}

/** Menjumlahkan beberapa status sekaligus, mis. seluruh tahap pengerjaan. */
export function sumStatuses(
  counts: Readonly<Record<string, number>>,
  statuses: readonly string[],
): number {
  return statuses.reduce((jumlah, status) => jumlah + (counts[status] ?? 0), 0);
}
