import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/Layout';
import { StageBars, StatTile } from '../../components/Stats';
import { StatusBadge } from '../../components/StatusBadge';
import { Alert, Card, EmptyState, ErrorBlock, LoadingBlock } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useApiQuery } from '../../hooks/useApi';
import { formatDateTime, formatRelative } from '../../lib/format';
import { MAIN_STAGES, REPORT_STATUS } from '../../lib/status';

interface ReportRow {
  reportCode: string;
  status: string;
  platformName: string | null;
  packageQuantity: number;
  owner?: { email: string; fullName: string };
  createdAt: string;
  updatedAt: string;
}

interface ReportListResponse {
  total: number;
  items: ReportRow[];
}

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

export default function AdminDashboardPage() {
  const { can } = useAuth();
  const reports = useApiQuery<ReportListResponse>('/admin/reports?pageSize=100');
  const queue = useApiQuery<QueueRow[]>('/admin/reports/review-queue');
  const outbox = useApiQuery<OutboxStats>(
    can('notification.manage') ? '/admin/notifications/stats' : null,
  );

  if (reports.loading) return <LoadingBlock />;
  if (reports.error) return <ErrorBlock message={reports.error} onRetry={reports.reload} />;

  const items = reports.data?.items ?? [];
  const countByStatus = (status: string) => items.filter((item) => item.status === status).length;

  const awaitingReview = countByStatus('WAITING_REVIEW');
  const awaitingFulfilment = countByStatus('APPROVED');
  const inFulfilment = countByStatus('SUBMITTED') + countByStatus('PARTIALLY_COMPLETED');
  const paymentReview = countByStatus('PAYMENT_REVIEW');

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
