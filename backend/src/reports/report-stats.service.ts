import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  calculateQueueAge,
  fillStatusCounts,
  formatDuration,
  startOfMonthJakarta,
  sumStatuses,
} from './report-stats';
import { ALL_STATUSES } from './state-machine';

/**
 * Angka ringkas untuk dasbor admin.
 *
 * Seluruh hitungan dilakukan basis data, bukan di peramban.
 *
 * Sebelumnya dasbor mengambil seratus laporan terakhir lalu menghitungnya
 * sendiri di sisi klien. Selama laporan masih sedikit angkanya kebetulan
 * benar; melewati seratus, dasbor akan menampilkan angka yang salah tanpa
 * satu pun tanda bahwa ia salah. Kesalahan yang diam seperti itu lebih
 * berbahaya daripada halaman yang gagal dimuat, karena orang mengambil
 * keputusan berdasarkan angkanya.
 */

/** Status yang dianggap sedang dikerjakan admin. */
const SEDANG_DIKERJAKAN = ['SUBMITTED', 'PARTIALLY_COMPLETED'] as const;

/** Status yang sudah selesai, apa pun hasilnya. */
const SUDAH_SELESAI = ['COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED'] as const;

/**
 * Batas jumlah baris antrean yang ditarik untuk menghitung umur.
 *
 * Yang ditarik hanya satu kolom waktu, jadi biayanya kecil. Batas ini ada
 * sebagai pagar terhadap keadaan tidak wajar — antrean puluhan ribu laporan
 * berarti ada yang jauh lebih salah daripada sekadar dasbor lambat.
 */
const BATAS_ANTREAN = 5000;

@Injectable()
export class ReportStatsService {
  constructor(private readonly prisma: PrismaService) {}

  async summary() {
    const now = new Date();
    const awalBulan = startOfMonthJakarta(now);

    const [grup, antrean, komdigiBulanIni, komdigiTotal, totalLaporan] = await Promise.all([
      this.prisma.report.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),

      this.prisma.report.findMany({
        where: { status: 'WAITING_REVIEW' },
        select: { updatedAt: true },
        orderBy: { updatedAt: 'asc' },
        take: BATAS_ANTREAN,
      }),

      this.prisma.complaintSubmission.count({
        where: {
          channel: 'KOMDIGI_EMAIL',
          deliveryStatus: 'SENT',
          submittedAt: { gte: awalBulan },
        },
      }),

      this.prisma.complaintSubmission.count({
        where: { channel: 'KOMDIGI_EMAIL', deliveryStatus: 'SENT' },
      }),

      this.prisma.report.count(),
    ]);

    const byStatus = fillStatusCounts(
      grup.map((baris) => ({ status: baris.status as string, count: baris._count._all })),
      ALL_STATUSES,
    );

    const umurAntrean = calculateQueueAge(
      antrean.map((baris) => ({ waitingSince: baris.updatedAt })),
      now,
    );

    return {
      generatedAt: now.toISOString(),
      totalReports: totalLaporan,
      byStatus,

      reviewQueue: {
        count: umurAntrean.count,
        averageSeconds: umurAntrean.averageSeconds,
        averageLabel: formatDuration(umurAntrean.averageSeconds),
        oldestSeconds: umurAntrean.oldestSeconds,
        oldestLabel: formatDuration(umurAntrean.oldestSeconds),
        // Benar bila antrean melewati batas; dasbor menampilkan penanda
        // supaya angkanya tidak dibaca sebagai hasil pasti.
        truncated: umurAntrean.count >= BATAS_ANTREAN,
      },

      awaitingFulfilment: byStatus.APPROVED ?? 0,
      inFulfilment: sumStatuses(byStatus, SEDANG_DIKERJAKAN),
      finished: sumStatuses(byStatus, SUDAH_SELESAI),
      paymentReview: byStatus.PAYMENT_REVIEW ?? 0,

      komdigi: {
        thisMonth: komdigiBulanIni,
        total: komdigiTotal,
        monthStart: awalBulan.toISOString(),
      },
    };
  }
}
