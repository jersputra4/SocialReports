import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/Layout';
import { StatTile } from '../../components/Stats';
import { StatusBadge } from '../../components/StatusBadge';
import { Alert, Card, EmptyState, ErrorBlock, LoadingBlock } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useApiQuery } from '../../hooks/useApi';
import { formatDateTime, formatRupiah } from '../../lib/format';
import { presentStatus } from '../../lib/status';

interface ReportListItem {
  reportCode: string;
  status: string;
  packageQuantity: number;
  platformName: string | null;
  totalAmount: string | null;
  targetUrl: string | null;
  createdAt: string;
}

interface ReportListResponse {
  total: number;
  items: ReportListItem[];
}

const ACTION_NEEDED = ['DRAFT', 'WAITING_PAYMENT', 'NEEDS_REVISION', 'PAYMENT_REJECTED', 'EXPIRED'];
const IN_PROGRESS = ['PAID', 'WAITING_REVIEW', 'APPROVED', 'SUBMITTED', 'PARTIALLY_COMPLETED'];

export default function DashboardPage() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useApiQuery<ReportListResponse>(
    '/reports?pageSize=100',
  );

  if (loading) return <LoadingBlock />;
  if (error) return <ErrorBlock message={error} onRetry={reload} />;

  const items = data?.items ?? [];
  const needsAction = items.filter((item) => ACTION_NEEDED.includes(item.status));
  const inProgress = items.filter((item) => IN_PROGRESS.includes(item.status));
  const completed = items.filter((item) => item.status === 'COMPLETED');

  return (
    <>
      <PageHeader
        title={`Halo, ${user?.fullName.split(' ')[0] ?? 'Anda'}`}
        description="Ringkasan report Anda dan hal yang menunggu tindakan."
        actions={
          <Link to="/report/baru" className="btn-primary">
            Buat report baru
          </Link>
        }
      />

      {/* Deret angka utama: stat tile, bukan grafik — datanya memang beberapa
          angka tunggal, bukan perbandingan antar kategori. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Total report" value={data?.total ?? 0} emphasis />
        <StatTile
          label="Menunggu tindakan Anda"
          value={needsAction.length}
          hint={needsAction.length > 0 ? 'Ada yang perlu Anda selesaikan.' : 'Tidak ada.'}
        />
        <StatTile label="Sedang diproses" value={inProgress.length} />
        <StatTile label="Selesai" value={completed.length} />
      </div>

      {needsAction.length > 0 && (
        <div className="mt-6">
          <Card
            title="Menunggu tindakan Anda"
            description="Report berikut berhenti sampai Anda menindaklanjutinya."
          >
            <ul className="divide-y divide-hairline">
              {needsAction.map((item) => (
                <li key={item.reportCode} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/report/${item.reportCode}`}
                      className="font-mono text-sm font-semibold text-accent-700 underline"
                    >
                      {item.reportCode}
                    </Link>
                    <p className="mt-0.5 truncate text-sm text-ink-secondary">
                      {item.platformName ?? 'Platform belum tercatat'} · {item.packageQuantity} unit
                    </p>
                    <p className="mt-1 text-xs text-ink-muted">
                      {presentStatus(item.status).description}
                    </p>
                  </div>
                  <StatusBadge status={item.status} />
                  <Link to={`/report/${item.reportCode}`} className="btn-secondary">
                    Buka
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      <div className="mt-6">
        <Card
          title="Report terbaru"
          actions={
            <Link to="/report" className="btn-ghost">
              Lihat semua
            </Link>
          }
        >
          {items.length === 0 ? (
            <EmptyState
              title="Belum ada report"
              description="Mulai dengan menempelkan tautan konten atau akun yang ingin dilaporkan."
              action={
                <Link to="/report/baru" className="btn-primary">
                  Buat report pertama
                </Link>
              }
            />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Kode</th>
                    <th>Platform</th>
                    <th>Paket</th>
                    <th>Total</th>
                    <th>Status</th>
                    <th>Dibuat</th>
                  </tr>
                </thead>
                <tbody>
                  {items.slice(0, 8).map((item) => (
                    <tr key={item.reportCode}>
                      <td>
                        <Link
                          to={`/report/${item.reportCode}`}
                          className="font-mono text-accent-700 underline"
                        >
                          {item.reportCode}
                        </Link>
                      </td>
                      <td>{item.platformName ?? '—'}</td>
                      <td className="numeric">{item.packageQuantity}</td>
                      <td className="numeric">{formatRupiah(item.totalAmount)}</td>
                      <td>
                        <StatusBadge status={item.status} size="sm" />
                      </td>
                      <td className="whitespace-nowrap text-ink-secondary">
                        {formatDateTime(item.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <Alert tone="info" title="Yang dilakukan dan tidak dilakukan sistem ini">
          <p>
            Sistem membuat, mendokumentasikan, dan memantau laporan. Sistem tidak menurunkan
            konten atau akun, dan tidak dapat menjamin platform akan menindaklanjuti laporan.
            Bukti bahwa laporan sudah dikerjakan tersedia pada tab Bukti Pengerjaan di setiap
            report.
          </p>
        </Alert>
      </div>
    </>
  );
}
