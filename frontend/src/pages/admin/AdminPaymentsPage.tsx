import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/Layout';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  ErrorBlock,
  Field,
  LoadingBlock,
  Modal,
  Select,
  Textarea,
} from '../../components/ui';
import { useAction, useApiQuery } from '../../hooks/useApi';
import { api } from '../../lib/api';
import { formatCountdown, formatDate, formatDateTime, formatRupiah } from '../../lib/format';

interface PendingPayment {
  gatewayOrderId: string;
  reportCode: string;
  reportStatus: string;
  totalAmount: string;
  paidAmount: string;
  shortfall: string;
  createdAt: string;
  expiresAt: string;
}

interface Reconciliation {
  id: string;
  runDate: string;
  gatewayOrderId: string | null;
  gatewayStatus: string | null;
  dbStatus: string | null;
  difference: string;
  note: string | null;
  resolvedAt: string | null;
}

export default function AdminPaymentsPage() {
  const review = useApiQuery<PendingPayment[]>('/admin/payments/review');
  const reconciliations = useApiQuery<Reconciliation[]>('/admin/reconciliations?limit=50');
  const { run, pending, error, clearError } = useAction();

  const [target, setTarget] = useState<PendingPayment | null>(null);
  const [decision, setDecision] = useState<'ACCEPT' | 'REJECT'>('ACCEPT');
  const [reason, setReason] = useState('');

  const resolve = async () => {
    if (!target) return;
    const result = await run(() =>
      api.post(`/admin/payments/${target.gatewayOrderId}/resolve`, { decision, reason }),
    );
    if (result !== null) {
      setTarget(null);
      setReason('');
      review.reload();
    }
  };

  const runReconciliation = async () => {
    const result = await run(() => api.post('/admin/reconciliations/run'));
    if (result !== null) reconciliations.reload();
  };

  const markResolved = async (id: string) => {
    const result = await run(() => api.post(`/admin/reconciliations/${id}/resolve`));
    if (result !== null) reconciliations.reload();
  };

  return (
    <>
      <PageHeader
        title="Pembayaran"
        description="Pembayaran yang tertahan dan hasil rekonsiliasi harian."
        actions={
          <Button loading={pending} onClick={runReconciliation}>
            Jalankan rekonsiliasi sekarang
          </Button>
        }
      />

      {error && (
        <div className="mb-4">
          <Alert tone="danger" onDismiss={clearError}>
            {error.map((message) => (
              <p key={message}>{message}</p>
            ))}
          </Alert>
        </div>
      )}

      <Card
        title="Menunggu keputusan"
        description="Pembayaran kurang bayar atau tidak cocok, menunggu tindakan Finance."
        className="mb-6"
      >
        {review.loading && <LoadingBlock />}
        {review.error && <ErrorBlock message={review.error} onRetry={review.reload} />}
        {review.data && review.data.length === 0 && (
          <EmptyState
            title="Tidak ada pembayaran tertahan"
            description="Semua pembayaran terproses otomatis."
          />
        )}

        {review.data && review.data.length > 0 && (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Report</th>
                  <th>Tagihan</th>
                  <th>Diterima</th>
                  <th>Kurang</th>
                  <th>Batas waktu</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {review.data.map((row) => (
                  <tr key={row.gatewayOrderId}>
                    <td className="font-mono text-xs">{row.gatewayOrderId}</td>
                    <td>
                      <Link
                        to={`/admin/report/${row.reportCode}`}
                        className="font-mono text-accent-700 underline"
                      >
                        {row.reportCode}
                      </Link>
                    </td>
                    <td className="numeric">{formatRupiah(row.totalAmount)}</td>
                    <td className="numeric">{formatRupiah(row.paidAmount)}</td>
                    <td className="numeric font-semibold text-red-900">
                      {formatRupiah(row.shortfall)}
                    </td>
                    <td className="whitespace-nowrap text-xs">
                      {formatCountdown(row.expiresAt)}
                    </td>
                    <td>
                      <Button onClick={() => setTarget(row)}>Putuskan</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="Rekonsiliasi"
        description="Selisih antara laporan gateway dan catatan database. Ditindaklanjuti dalam 1 hari kerja."
      >
        {reconciliations.loading && <LoadingBlock />}
        {reconciliations.data && reconciliations.data.length === 0 && (
          <EmptyState
            title="Tidak ada selisih"
            description="Rekonsiliasi terakhir tidak menemukan perbedaan."
          />
        )}

        {reconciliations.data && reconciliations.data.length > 0 && (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Tanggal</th>
                  <th>Order</th>
                  <th>Gateway</th>
                  <th>Database</th>
                  <th>Selisih</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {reconciliations.data.map((row) => (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap">{formatDate(row.runDate)}</td>
                    <td className="font-mono text-xs">{row.gatewayOrderId ?? '—'}</td>
                    <td>{row.gatewayStatus ?? '—'}</td>
                    <td>{row.dbStatus ?? '—'}</td>
                    <td className="numeric">{formatRupiah(row.difference)}</td>
                    <td>
                      {row.resolvedAt ? (
                        <span className="text-success">✓ Ditindaklanjuti</span>
                      ) : (
                        <span className="text-red-900">! Belum</span>
                      )}
                    </td>
                    <td>
                      {!row.resolvedAt && (
                        <Button loading={pending} onClick={() => markResolved(row.id)}>
                          Tandai selesai
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={target !== null}
        onClose={() => setTarget(null)}
        title="Keputusan pembayaran"
        description={
          target
            ? `${target.gatewayOrderId} · kurang ${formatRupiah(target.shortfall)} dari tagihan.`
            : undefined
        }
        footer={
          <>
            <Button onClick={() => setTarget(null)}>Batal</Button>
            <Button
              variant={decision === 'ACCEPT' ? 'primary' : 'danger'}
              loading={pending}
              disabled={reason.trim().length < 10}
              onClick={resolve}
            >
              Simpan keputusan
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Alert tone="info">
            <p>
              Tidak ada alur pengembalian dana. Keputusan hanya menentukan apakah report
              dilanjutkan atau pembayarannya ditolak.
            </p>
          </Alert>

          <Field label="Keputusan" required>
            <Select
              value={decision}
              onChange={(event) => setDecision(event.target.value as typeof decision)}
            >
              <option value="ACCEPT">Terima — lanjutkan report ke antrean review</option>
              <option value="REJECT">Tolak — pelapor dapat membuat tagihan baru</option>
            </Select>
          </Field>

          <Field label="Alasan" required hint="Minimal 10 karakter. Tercatat di audit log.">
            <Textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={4} />
          </Field>

          {target && (
            <p className="text-xs text-ink-muted">
              Dibuat {formatDateTime(target.createdAt)}
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}
