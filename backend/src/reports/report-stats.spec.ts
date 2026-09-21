import {
  calculateQueueAge,
  fillStatusCounts,
  formatDuration,
  startOfMonthJakarta,
  sumStatuses,
} from './report-stats';

const NOW = new Date('2026-09-21T10:00:00.000Z');

function menitLalu(menit: number): { waitingSince: Date } {
  return { waitingSince: new Date(NOW.getTime() - menit * 60_000) };
}

describe('calculateQueueAge', () => {
  it('mengembalikan nol untuk antrean kosong, bukan NaN', () => {
    const hasil = calculateQueueAge([], NOW);
    expect(hasil.count).toBe(0);
    expect(hasil.averageSeconds).toBe(0);
    expect(hasil.oldestSeconds).toBe(0);
  });

  it('menghitung rata-rata dari beberapa laporan', () => {
    const hasil = calculateQueueAge([menitLalu(10), menitLalu(20), menitLalu(30)], NOW);
    expect(hasil.count).toBe(3);
    expect(hasil.averageSeconds).toBe(20 * 60);
  });

  it('menemukan laporan yang paling lama menunggu', () => {
    const hasil = calculateQueueAge([menitLalu(5), menitLalu(120), menitLalu(45)], NOW);
    expect(hasil.oldestSeconds).toBe(120 * 60);
  });

  it('menjepit waktu di masa depan menjadi nol', () => {
    const depan = { waitingSince: new Date(NOW.getTime() + 60_000) };
    const hasil = calculateQueueAge([depan], NOW);
    expect(hasil.oldestSeconds).toBe(0);
    expect(hasil.averageSeconds).toBe(0);
  });

  it('menangani satu laporan tunggal', () => {
    const hasil = calculateQueueAge([menitLalu(90)], NOW);
    expect(hasil.count).toBe(1);
    expect(hasil.averageSeconds).toBe(90 * 60);
    expect(hasil.oldestSeconds).toBe(90 * 60);
  });
});

describe('formatDuration', () => {
  it('menyatakan durasi sangat pendek tanpa angka membingungkan', () => {
    expect(formatDuration(30)).toBe('kurang dari 1 menit');
  });

  it('menangani nol', () => {
    expect(formatDuration(0)).toBe('kurang dari 1 menit');
  });

  it('menangani nilai negatif tanpa melempar', () => {
    expect(formatDuration(-100)).toBe('kurang dari 1 menit');
  });

  it('membulatkan ke menit', () => {
    expect(formatDuration(20 * 60)).toBe('20 menit');
  });

  it('membulatkan ke jam setelah melewati satu jam', () => {
    expect(formatDuration(3 * 3600)).toBe('3 jam');
  });

  it('membulatkan ke hari setelah melewati 24 jam', () => {
    expect(formatDuration(50 * 3600)).toBe('2 hari');
  });

  it('memakai satuan terbesar yang masuk akal, bukan gabungan', () => {
    // 25 jam adalah "1 hari", bukan "1 hari 1 jam".
    expect(formatDuration(25 * 3600)).toBe('1 hari');
  });
});

describe('startOfMonthJakarta', () => {
  it('memakai zona Jakarta, bukan UTC', () => {
    // 2026-09-01 pukul 03:00 WIB masih 2026-08-31 pukul 20:00 UTC.
    // Awal bulan yang benar adalah 31 Agustus pukul 17:00 UTC.
    const hasil = startOfMonthJakarta(new Date('2026-08-31T20:00:00.000Z'));
    expect(hasil.toISOString()).toBe('2026-08-31T17:00:00.000Z');
  });

  it('memberi awal bulan yang sama untuk waktu mana pun dalam bulan itu', () => {
    const awal = startOfMonthJakarta(new Date('2026-09-01T00:00:00.000Z'));
    const tengah = startOfMonthJakarta(new Date('2026-09-15T12:00:00.000Z'));
    expect(awal.toISOString()).toBe(tengah.toISOString());
  });

  it('menangani pergantian tahun', () => {
    const hasil = startOfMonthJakarta(new Date('2027-01-10T00:00:00.000Z'));
    expect(hasil.toISOString()).toBe('2026-12-31T17:00:00.000Z');
  });
});

describe('fillStatusCounts', () => {
  const SEMUA = ['DRAFT', 'WAITING_REVIEW', 'APPROVED'];

  it('mengisi status yang tidak dikembalikan basis data dengan nol', () => {
    const hasil = fillStatusCounts([{ status: 'DRAFT', count: 5 }], SEMUA);
    expect(hasil.DRAFT).toBe(5);
    expect(hasil.WAITING_REVIEW).toBe(0);
    expect(hasil.APPROVED).toBe(0);
  });

  it('memuat seluruh status meski basis data mengembalikan kosong', () => {
    const hasil = fillStatusCounts([], SEMUA);
    expect(Object.keys(hasil)).toHaveLength(3);
  });

  it('mempertahankan nilai dari basis data', () => {
    const hasil = fillStatusCounts(
      [
        { status: 'DRAFT', count: 2 },
        { status: 'APPROVED', count: 7 },
      ],
      SEMUA,
    );
    expect(hasil.APPROVED).toBe(7);
  });
});

describe('sumStatuses', () => {
  const COUNTS = { DRAFT: 2, WAITING_REVIEW: 3, APPROVED: 5 };

  it('menjumlahkan beberapa status', () => {
    expect(sumStatuses(COUNTS, ['WAITING_REVIEW', 'APPROVED'])).toBe(8);
  });

  it('mengabaikan status yang tidak ada alih-alih melempar', () => {
    expect(sumStatuses(COUNTS, ['APPROVED', 'TIDAK_ADA'])).toBe(5);
  });

  it('mengembalikan nol untuk daftar kosong', () => {
    expect(sumStatuses(COUNTS, [])).toBe(0);
  });
});
