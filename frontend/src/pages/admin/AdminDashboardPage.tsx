import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/Layout';
import { StageBars, StatTile } from '../../components/Stats';
import { StatusBadge } from '../../components/StatusBadge';
import { Alert, Card, EmptyState, ErrorBlock, LoadingBlock } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useApiQuery } from '../../hooks/useApi';
import { formatDateTime, formatRelative } from '../../lib/format';
import { MAIN_STAGES, REPORT_STATUS } from '../../lib/status';

interface QueueRow {
  reportCode: string;
  platformName: string | null;
  policyName: string | null;
  packageQuantity: number;
  evidenceCount: number;
  waitingSince: string;
  owner: string;
}

interface OutboxStats {
  pending: number;
  failed: number;
  dead: number;
  oldestBacklogSeconds: number;
  alerting: boolean;
}

/** Bentuk tanggapan `GET /admin/reports/stats`. */
interface ReportStats {
  generatedAt: string;
  totalReports: number;
  byStatus: Record<string, number>;
  reviewQueue: {
    count: number;
    averageLabel: string;
    oldestLabel: string;
    truncated: boolean;
  };
  awaitingFulfilment: number;
  inFulfilment: number;
  finished: number;
  paymentReview: number;
  komdigi: {
    thisMonth: number;
    total: number;
    monthStart: string;
  };
}

export default function AdminDashboardPage() {
  const { can } = useAuth();
  // Angka diambil dari agregasi basis data, bukan dihitung di peramban dari
  // sejumlah baris terakhir. Perhitungan sisi klien tampak benar selama
  // laporan masih sedikit, lalu salah tanpa memberi tanda apa pun.
  const stats = useApiQuery<ReportStats>('/admin/reports/stats');
  const queue = useApiQuery<QueueRow[]>('/admin/reports/review-queue');
  const outbox = useApiQuery<OutboxStats>(
    can('notification.manage') ? '/admin/notifications/stats' : null,
  );

  if (stats.loading) return <LoadingBlock />;
  if (stats.error) return <ErrorBlock message={stats.error} onRetry={stats.reload} />;
  if (!stats.data) return <ErrorBlock message="Statistik tidak tersedia." onRetry={stats.reload} />;

  const data = stats.data;
  const countByStatus = (status: string) => data.byStatus[status] ?? 0;

  const awaitingReview = data.reviewQueue.count;
  const awaitingFulfilment = data.awaitingFulfilment;
  const inFulfilment = data.inFulfilment;
  const paymentReview = data.paymentReview;

  const stageData = MAIN_STAGES.map((stage) => ({
    label: stage.short,
    value: countByStatus(stage.status),
  }));

  // Status yang jumlahnya bukan nol, untuk tabel rincian. Lebih dari tujuh
  // kelas: tabel, bukan warna tambahan.
  const breakdown = Object.keys(REPORT_STATUS)
    .map((status) => ({ status, count: countByStatus(status) }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count);

  return (
    <>
      <PageHeader
        title="Dasbor operasional"
        description="Apa yang menunggu dikerjakan hari ini."
      />

      {outbox.data?.alerting && (
        <div className="mb-6">
          <Alert tone="danger" title="Notifikasi tertahan">
            <p>
              {outbox.data.dead > 0
                ? `${outbox.data.dead} event masuk dead-letter queue dan menunggu percobaan ulang manual.`
                : `Event tertua sudah menunggu ${Math.round(outbox.data.oldestBacklogSeconds / 60)} menit.`}
            </p>
            <p className="mt-2">
              <Link to="/admin/notifikasi" className="font-medium underline">
                Buka monitoring notifikasi
              </Link>
            </p>
          </Alert>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Antre review"
          value={awaitingReview}
          emphasis
          hint={awaitingReview > 0 ? 'Target: keputusan dalam 2 hari kerja.' : 'Antrean kosong.'}
        />
        <StatTile
          label="Disetujui, belum dilaporkan"
          value={awaitingFulfilment}
          hint="Target: dilaporkan dalam 1 hari kerja."
        />
        <StatTile label="Sedang dikerjakan" value={inFulfilment} />
        <StatTile
          label="Pembayaran perlu ditinjau"
          value={paymentReview}
          hint={paymentReview > 0 ? 'Perlu keputusan Finance.' : 'Tidak ada.'}
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Tunggu rata-rata"
          value={awaitingReview > 0 ? data.reviewQueue.averageLabel : '—'}
          hint={awaitingReview > 0 ? 'Rata-rata lama menunggu di antrean.' : 'Antrean kosong.'}
        />
        <StatTile
          label="Menunggu paling lama"
          value={awaitingReview > 0 ? data.reviewQueue.oldestLabel : '—'}
          hint={
            data.reviewQueue.truncated
              ? 'Antrean sangat panjang; angka ini perkiraan.'
              : 'Report tertua di antrean.'
          }
        />
        <StatTile
          label="Aduan Komdigi bulan ini"
          value={data.komdigi.thisMonth}
          hint={`Sejak ${formatDateTime(data.komdigi.monthStart)}.`}
        />
        <StatTile
          label="Total report"
          value={data.totalReports}
          hint={`${data.finished} sudah selesai.`}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card
          title="Report per tahap"
          description="Jumlah report yang sedang berada di tiap tahap."
        >
          <StageBars items={stageData} />
        </Card>

        <Card title="Rincian seluruh status">
          {breakdown.length === 0 ? (
            <EmptyState title="Belum ada report" />
          ) : (
            <div className="table-wrap">
              <table className="data-table min-w-0">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th className="text-right">Jumlah</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.map((row) => (
                    <tr key={row.status}>
                      <td>
                        <StatusBadge status={row.status} size="sm" />
                      </td>
                      <td className="numeric text-right font-semibold">{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <Card
          title="Antrean review"
          description="Report tertua lebih dulu."
          actions={
            <Link to="/admin/report?status=WAITING_REVIEW" className="btn-ghost">
              Lihat semua
            </Link>
          }
        >
          {queue.loading && <LoadingBlock />}
          {queue.data && queue.data.length === 0 && (
            <EmptyState title="Antrean kosong" description="Tidak ada report yang menunggu review." />
          )}
          {queue.data && queue.data.length > 0 && (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Kode</th>
                    <th>Pelapor</th>
                    <th>Platform</th>
                    <th>Kebijakan</th>
                    <th>Evidence</th>
                    <th>Menunggu</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.data.slice(0, 10).map((row) => (
                    <tr key={row.reportCode}>
                      <td>
                        <Link
                          to={`/admin/report/${row.reportCode}`}
                          className="font-mono text-accent-700 underline"
                        >
                          {row.reportCode}
                        </Link>
                      </td>
                      <td>{row.owner}</td>
                      <td>{row.platformName ?? '—'}</td>
                      <td className="max-w-[220px] truncate">{row.policyName ?? '—'}</td>
                      <td className="numeric">{row.evidenceCount}</td>
                      <td className="whitespace-nowrap">
                        {formatRelative(row.waitingSince)}
                        <span className="block text-xs text-ink-muted">
                          {formatDateTime(row.waitingSince)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
