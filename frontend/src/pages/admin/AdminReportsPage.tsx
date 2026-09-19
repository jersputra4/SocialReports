import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../../components/Layout';
import { StatusBadge } from '../../components/StatusBadge';
import { Card, EmptyState, ErrorBlock, Input, LoadingBlock, Select } from '../../components/ui';
import { useApiQuery } from '../../hooks/useApi';
import { formatDateTime, formatNumber, formatRupiah } from '../../lib/format';
import { REPORT_STATUS } from '../../lib/status';

interface ReportRow {
  reportCode: string;
  status: string;
  platformName: string | null;
  packageQuantity: number;
  totalAmount: string | null;
  targetUrl: string | null;
  evidenceCount: number;
  proofCount: number;
  owner?: { email: string; fullName: string };
  createdAt: string;
  updatedAt: string;
}

interface Response {
  total: number;
  page: number;
  pageSize: number;
  items: ReportRow[];
}

export default function AdminReportsPage() {
  const [params] = useSearchParams();
  const [status, setStatus] = useState(params.get('status') ?? 'ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const query = new URLSearchParams({
    status,
    page: String(page),
    pageSize: '25',
  });
  if (search.trim()) query.set('search', search.trim());

  const { data, loading, error, reload } = useApiQuery<Response>(
    `/admin/reports?${query.toString()}`,
    [status, search, page],
  );

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <PageHeader
        title="Semua report"
        description="Seluruh report dari semua pengguna."
      />

      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-[220px_1fr]">
          <div>
            <label className="label" htmlFor="status">
              Status
            </label>
            <Select
              id="status"
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
          <div>
            <label className="label" htmlFor="cari">
              Cari kode report atau email pelapor
            </label>
            <Input
              id="cari"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="RPT-… atau nama@contoh.com"
            />
          </div>
        </div>

        {loading && <LoadingBlock />}
        {error && <ErrorBlock message={error} onRetry={reload} />}

        {data && data.items.length === 0 && (
          <EmptyState title="Tidak ada report" description="Ubah filter atau kata kunci pencarian." />
        )}

        {data && data.items.length > 0 && (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Kode</th>
                    <th>Pelapor</th>
                    <th>Target</th>
                    <th>Paket</th>
                    <th>Total</th>
                    <th>Bukti kerja</th>
                    <th>Status</th>
                    <th>Diperbarui</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row) => (
                    <tr key={row.reportCode}>
                      <td>
                        <Link
                          to={`/admin/report/${row.reportCode}`}
                          className="font-mono text-accent-700 underline"
                        >
                          {row.reportCode}
                        </Link>
                      </td>
                      <td className="max-w-[180px]">
                        <p className="truncate">{row.owner?.fullName ?? '—'}</p>
                        <p className="truncate text-xs text-ink-muted">{row.owner?.email}</p>
                      </td>
                      <td className="max-w-[200px]">
                        <p>{row.platformName ?? '—'}</p>
                        <p className="truncate text-xs text-ink-muted" title={row.targetUrl ?? ''}>
                          {row.targetUrl ?? '—'}
                        </p>
                      </td>
                      <td className="numeric">{formatNumber(row.packageQuantity)}</td>
                      <td className="numeric">{formatRupiah(row.totalAmount)}</td>
                      <td className="numeric">{row.proofCount}</td>
                      <td>
                        <StatusBadge status={row.status} size="sm" />
                      </td>
                      <td className="whitespace-nowrap text-ink-secondary">
                        {formatDateTime(row.updatedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <nav className="mt-4 flex items-center justify-between gap-3">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={page <= 1}
                  onClick={() => setPage((value) => value - 1)}
                >
                  Sebelumnya
                </button>
                <span className="text-sm text-ink-secondary">
                  Halaman {page} dari {totalPages} · {formatNumber(data.total)} report
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
