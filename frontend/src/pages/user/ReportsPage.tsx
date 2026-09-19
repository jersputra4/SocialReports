import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/Layout';
import { StatusBadge } from '../../components/StatusBadge';
import { Card, EmptyState, ErrorBlock, LoadingBlock, Select } from '../../components/ui';
import { useApiQuery } from '../../hooks/useApi';
import { formatDateTime, formatNumber, formatRupiah } from '../../lib/format';
import { REPORT_STATUS } from '../../lib/status';

interface ReportListItem {
  reportCode: string;
  status: string;
  actionType: string;
  packageQuantity: number;
  platformName: string | null;
  totalAmount: string | null;
  targetUrl: string | null;
  evidenceCount: number;
  proofCount: number;
  createdAt: string;
}

interface ReportListResponse {
  total: number;
  page: number;
  pageSize: number;
  items: ReportListItem[];
}

export default function ReportsPage() {
  const [status, setStatus] = useState('ALL');
  const [page, setPage] = useState(1);

  const { data, loading, error, reload } = useApiQuery<ReportListResponse>(
    `/reports?status=${encodeURIComponent(status)}&page=${page}&pageSize=20`,
    [status, page],
  );

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <PageHeader
        title="Report saya"
        description="Seluruh report yang pernah Anda buat, termasuk yang sudah selesai."
        actions={
          <Link to="/report/baru" className="btn-primary">
            Buat report baru
          </Link>
        }
      />

      <Card>
        {/* Filter berada dalam satu baris di atas tabel. */}
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-64">
            <label className="label" htmlFor="filter-status">
              Status
            </label>
            <Select
              id="filter-status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              <option value="ALL">Semua status</option>
              {Object.entries(REPORT_STATUS).map(([code, view]) => (
                <option key={code} value={code}>
                  {view.label}
                </option>
              ))}
            </Select>
          </div>
          {data && (
            <p className="pb-2 text-sm text-ink-secondary">
              {formatNumber(data.total)} report ditemukan
            </p>
          )}
        </div>

        {loading && <LoadingBlock />}
        {error && <ErrorBlock message={error} onRetry={reload} />}

        {!loading && !error && data && data.items.length === 0 && (
          <EmptyState
            title="Tidak ada report pada filter ini"
            description="Coba ubah filter status atau buat report baru."
          />
        )}

        {!loading && !error && data && data.items.length > 0 && (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Kode</th>
                    <th>Target</th>
                    <th>Paket</th>
                    <th>Total</th>
                    <th>Evidence</th>
                    <th>Bukti kerja</th>
                    <th>Status</th>
                    <th>Dibuat</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr key={item.reportCode}>
                      <td>
                        <Link
                          to={`/report/${item.reportCode}`}
                          className="font-mono text-accent-700 underline"
                        >
                          {item.reportCode}
                        </Link>
                      </td>
                      <td className="max-w-[220px]">
                        <p className="font-medium">{item.platformName ?? '—'}</p>
                        <p className="truncate text-xs text-ink-muted" title={item.targetUrl ?? ''}>
                          {item.targetUrl ?? '—'}
                        </p>
                      </td>
                      <td className="numeric">{formatNumber(item.packageQuantity)}</td>
                      <td className="numeric">{formatRupiah(item.totalAmount)}</td>
                      <td className="numeric">{item.evidenceCount}</td>
                      <td className="numeric">{item.proofCount}</td>
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

            {totalPages > 1 && (
              <nav className="mt-4 flex items-center justify-between gap-3" aria-label="Halaman">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={page <= 1}
                  onClick={() => setPage((value) => value - 1)}
                >
                  Sebelumnya
                </button>
                <span className="text-sm text-ink-secondary">
                  Halaman {page} dari {totalPages}
                </span>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={page >= totalPages}
                  onClick={() => setPage((value) => value + 1)}
                >
                  Berikutnya
                </button>
              </nav>
            )}
          </>
        )}
      </Card>
    </>
  );
}
