import { ReactNode, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '../../components/Layout';
import { ProgressMeter } from '../../components/Stats';
import { PaymentStatusBadge, StatusBadge } from '../../components/StatusBadge';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  Modal,
} from '../../components/ui';
import { useAction, useApiQuery } from '../../hooks/useApi';
import { api } from '../../lib/api';
import {
  formatBytes,
  formatCountdown,
  formatDateTime,
  formatNumber,
  formatRupiah,
  formatTaxRate,
} from '../../lib/format';
import { PROOF_TYPE_LABEL, presentStatus } from '../../lib/status';

interface ReportDetail {
  reportCode: string;
  status: string;
  description: string | null;
  packageQuantity: number;
  createdAt: string;
  submittedAt: string | null;
  completedAt: string | null;
  unitPriceSnapshot: string | null;
  subtotalSnapshot: string | null;
  taxRateBpSnapshot: number | null;
  taxAmountSnapshot: string | null;
  totalAmountSnapshot: string | null;
  platformNameSnapshot: string | null;
  actionType: { name: string };
  targetSnapshot: {
    originalUrl: string;
    canonicalUrl: string | null;
    fetchStatus: string;
    fetchError: string | null;
    metadataJson: Record<string, string> | null;
  } | null;
  policies: Array<{
    id: string;
    nameSnapshot: string;
    versionSnapshot: string | null;
    textSnapshot: string | null;
    otherReason: string | null;
  }>;
  legalBasis: Array<{
    id: string;
    lawNameSnapshot: string;
    lawVersionSnapshot: string | null;
    articleNumberSnapshot: string | null;
    paragraphNumberSnapshot: string | null;
    textSnapshot: string | null;
    otherReason: string | null;
  }>;
  evidences: Array<{
    id: string;
    fileName: string;
    fileSize: number;
    fileHash: string;
    caption: string | null;
    scanStatus: string;
    createdAt: string;
  }>;
  statusHistory: Array<{
    id: string;
    fromStatus: string | null;
    toStatus: string;
    reason: string | null;
    occurredAt: string;
  }>;
  reviewDecisions: Array<{ id: string; decision: string; reason: string; decidedAt: string }>;
  payments: Array<{
    gatewayOrderId: string;
    status: string;
    totalAmount: string;
    paidAmount: string;
    overpaidAmount: string;
    checkoutUrl: string | null;
    expiresAt: string;
    paidAt: string | null;
  }>;
  invoices: Array<{ invoiceNumber: string; total: string; issuedAt: string }>;
  documents: Array<{
    id: string;
    documentType: string;
    version: number;
    fileName: string;
    fileHash: string;
    includesProofs: boolean;
    generatedAt: string;
  }>;
  availableActions: string[];
}

interface ProofsResponse {
  items: Array<{
    id: string;
    proofType: string;
    reportedAt: string;
    caption: string | null;
    unitsReported: number | null;
    fileName: string;
    fileSize: number;
    fileHash: string;
    createdAt: string;
  }>;
  progress: { reportedUnits: number; packageQuantity: number; percentage: number } | null;
}

type Tab = 'ringkasan' | 'dasar' | 'evidence' | 'bukti' | 'dokumen' | 'riwayat';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'ringkasan', label: 'Ringkasan' },
  { id: 'dasar', label: 'Kebijakan & hukum' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'bukti', label: 'Bukti Pengerjaan' },
  { id: 'dokumen', label: 'Dokumen' },
  { id: 'riwayat', label: 'Riwayat' },
];

export default function ReportDetailPage() {
  const { reportCode = '' } = useParams();
  const [tab, setTab] = useState<Tab>('ringkasan');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);

  const report = useApiQuery<ReportDetail>(`/reports/${reportCode}`, [reportCode]);
  const proofs = useApiQuery<ProofsResponse>(`/reports/${reportCode}/proofs`, [reportCode]);
  const { run, pending, error, clearError } = useAction();

  if (report.loading) return <LoadingBlock />;
  if (report.error) return <ErrorBlock message={report.error} onRetry={report.reload} />;
  if (!report.data) return null;

  const data = report.data;
  const status = presentStatus(data.status);
  const activePayment = data.payments.find((payment) => payment.status === 'PENDING');

  const openFile = async (path: string, name: string) => {
    const result = await run(() => api.get<{ url: string }>(path));
    if (result) setPreview({ url: result.url, name });
  };

  const requestPdf = async (includeProofs: boolean) => {
    await run(() =>
      api.post(`/reports/${reportCode}/documents`, { includeProofs }),
    );
    setTimeout(() => report.reload(), 2500);
  };

  const cancelReport = async () => {
    const result = await run(() => api.post(`/reports/${reportCode}/cancel`, {}));
    if (result !== null) {
      setCancelOpen(false);
      report.reload();
    }
  };

  const resubmit = async () => {
    const result = await run(() => api.post(`/reports/${reportCode}/resubmit`, {}));
    if (result !== null) report.reload();
  };

  return (
    <>
      <PageHeader
        title={data.reportCode}
        description={status.description}
        actions={
          <>
            <Link to="/report" className="btn-ghost">
              Kembali
            </Link>
            {data.availableActions.includes('WAITING_REVIEW') && (
              <Button variant="primary" loading={pending} onClick={resubmit}>
                Kirim perbaikan
              </Button>
            )}
            {data.availableActions.includes('CANCELLED') && (
              <Button variant="danger" onClick={() => setCancelOpen(true)}>
                Batalkan
              </Button>
            )}
          </>
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

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <StatusBadge status={data.status} />
        <span className="text-sm text-ink-secondary">
          Dibuat {formatDateTime(data.createdAt)}
        </span>
      </div>

      {activePayment && (
        <div className="mb-6">
          <Alert tone="warning" title="Tagihan menunggu pembayaran">
            <p>
              Total {formatRupiah(activePayment.totalAmount)} · batas waktu{' '}
              {formatCountdown(activePayment.expiresAt)} ({formatDateTime(activePayment.expiresAt)}).
            </p>
            <p className="mt-2">
              <Link
                to={`/pembayaran/${activePayment.gatewayOrderId}`}
                className="font-medium underline"
              >
                Buka halaman pembayaran
              </Link>
            </p>
          </Alert>
        </div>
      )}

      {data.status === 'NEEDS_REVISION' && data.reviewDecisions[0] && (
        <div className="mb-6">
          <Alert tone="warning" title="Perbaikan yang diminta reviewer">
            <p>{data.reviewDecisions[0].reason}</p>
            <p className="mt-2 text-xs">
              Perbaikan tidak memerlukan pembayaran baru. Setelah diperbaiki, tekan
              &ldquo;Kirim perbaikan&rdquo;.
            </p>
          </Alert>
        </div>
      )}

      {/* Tab */}
      <div className="mb-4 overflow-x-auto border-b border-hairline no-print">
        <nav className="flex min-w-max gap-1" role="tablist">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
              className={`whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium ${
                tab === item.id
                  ? 'border-accent-600 text-accent-700'
                  : 'border-transparent text-ink-secondary hover:text-ink'
              }`}
            >
              {item.label}
              {item.id === 'bukti' && (proofs.data?.items.length ?? 0) > 0 && (
                <span className="ml-2 rounded-full bg-accent-50 px-2 py-0.5 text-xs text-accent-800">
                  {proofs.data?.items.length}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* ------------------------------------------------------------ ringkasan */}
      {tab === 'ringkasan' && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Card title="Target pelaporan">
              <dl className="divide-y divide-hairline text-sm">
                <Row label="Platform" value={data.platformNameSnapshot ?? '—'} />
                <Row label="Jenis tindakan" value={data.actionType.name} />
                <Row
                  label="URL target"
                  value={
                    <span className="break-all">{data.targetSnapshot?.originalUrl ?? '—'}</span>
                  }
                />
                <Row
                  label="Judul tersimpan"
                  value={data.targetSnapshot?.metadataJson?.title ?? '—'}
                />
                <Row
                  label="Status pengambilan"
                  value={
                    data.targetSnapshot?.fetchStatus === 'OK'
                      ? 'Berhasil'
                      : data.targetSnapshot?.fetchStatus === 'PARTIAL'
                        ? 'Sebagian'
                        : 'Tidak tersedia'
                  }
                />
                {data.description && <Row label="Keterangan" value={data.description} />}
              </dl>
            </Card>
          </div>

          <div className="space-y-6">
            <Card title="Rincian biaya">
              <dl className="divide-y divide-hairline text-sm">
                <Row
                  label={`Paket ${formatNumber(data.packageQuantity)} unit`}
                  value={`${formatRupiah(data.unitPriceSnapshot)} / unit`}
                />
                <Row label="Subtotal" value={formatRupiah(data.subtotalSnapshot)} />
                <Row
                  label={`PPN ${formatTaxRate(data.taxRateBpSnapshot)}`}
                  value={formatRupiah(data.taxAmountSnapshot)}
                />
                <Row
                  label={<span className="font-semibold">Total</span>}
                  value={
                    <span className="font-semibold">{formatRupiah(data.totalAmountSnapshot)}</span>
                  }
                />
              </dl>
              {data.invoices[0] && (
                <p className="mt-3 text-xs text-ink-muted">
                  Invoice {data.invoices[0].invoiceNumber} ·{' '}
                  {formatDateTime(data.invoices[0].issuedAt)}
                </p>
              )}
              <p className="mt-3 text-xs text-ink-muted">
                Nilai ini dibekukan saat tagihan dibuat dan tidak berubah walaupun harga berubah.
              </p>
            </Card>

            {data.payments.length > 0 && (
              <Card title="Pembayaran">
                <ul className="space-y-3 text-sm">
                  {data.payments.map((payment) => (
                    <li key={payment.gatewayOrderId} className="rounded-lg border border-hairline p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs">{payment.gatewayOrderId}</span>
                        <PaymentStatusBadge status={payment.status} />
                      </div>
                      <p className="mt-2 text-ink-secondary">
                        Dibayar {formatRupiah(payment.paidAmount)} dari{' '}
                        {formatRupiah(payment.totalAmount)}
                      </p>
                      {payment.overpaidAmount !== '0' && (
                        <p className="mt-1 text-xs text-ink-muted">
                          Kelebihan {formatRupiah(payment.overpaidAmount)} tidak dikembalikan.
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- dasar */}
      {tab === 'dasar' && (
        <div className="space-y-6">
          <Card
            title="Kebijakan platform"
            description="Disalin saat report dibuat, lalu dikunci."
          >
            {data.policies.length === 0 ? (
              <EmptyState title="Belum ada kebijakan dipilih" />
            ) : (
              <ol className="space-y-4">
                {data.policies.map((policy, index) => (
                  <li key={policy.id}>
                    <p className="font-medium">
                      {index + 1}. {policy.nameSnapshot}
                      {policy.versionSnapshot && (
                        <span className="ml-2 text-xs text-ink-muted">
                          versi {policy.versionSnapshot}
                        </span>
                      )}
                    </p>
                    {policy.textSnapshot && (
                      <p className="mt-1 border-l-2 border-hairline pl-3 text-sm text-ink-secondary">
                        {policy.textSnapshot}
                      </p>
                    )}
                    {policy.otherReason && (
                      <p className="mt-1 text-sm text-ink-secondary">{policy.otherReason}</p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card title="Dasar hukum" description="Disalin saat report dibuat, lalu dikunci.">
            {data.legalBasis.length === 0 ? (
              <EmptyState title="Belum ada dasar hukum dipilih" />
            ) : (
              <ol className="space-y-4">
                {data.legalBasis.map((legal, index) => (
                  <li key={legal.id}>
                    <p className="font-medium">
                      {index + 1}. {legal.lawNameSnapshot}
                      {legal.articleNumberSnapshot && ` — Pasal ${legal.articleNumberSnapshot}`}
                      {legal.paragraphNumberSnapshot && ` Ayat ${legal.paragraphNumberSnapshot}`}
                    </p>
                    {legal.textSnapshot && (
                      <p className="mt-1 border-l-2 border-hairline pl-3 text-sm text-ink-secondary">
                        {legal.textSnapshot}
                      </p>
                    )}
                    {legal.otherReason && (
                      <p className="mt-1 text-sm text-ink-secondary">{legal.otherReason}</p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      )}

      {/* ------------------------------------------------------------- evidence */}
      {tab === 'evidence' && (
        <Card
          title="Evidence"
          description="Berkas yang Anda unggah. Data lokasi pada gambar sudah dibuang sistem."
        >
          {data.evidences.length === 0 ? (
            <EmptyState title="Tidak ada evidence" />
          ) : (
            <ul className="divide-y divide-hairline">
              {data.evidences.map((evidence) => (
                <li key={evidence.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{evidence.fileName}</p>
                    <p className="text-xs text-ink-muted">
                      {formatBytes(evidence.fileSize)} · SHA-256 {evidence.fileHash.slice(0, 12)}…
                    </p>
                    {evidence.caption && (
                      <p className="mt-1 text-sm text-ink-secondary">{evidence.caption}</p>
                    )}
                  </div>
                  <Button
                    loading={pending}
                    onClick={() => openFile(`/evidences/${evidence.id}/download-url`, evidence.fileName)}
                  >
                    Lihat
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* ---------------------------------------------------------------- bukti */}
      {tab === 'bukti' && (
        <Card
          title="Bukti Pengerjaan"
          description="Tangkapan layar yang diunggah admin sebagai bukti bahwa laporan sudah dikerjakan."
        >
          {proofs.loading && <LoadingBlock />}

          {proofs.data?.progress && (
            <div className="mb-5 rounded-lg border border-hairline p-4">
              <ProgressMeter
                label="Progres unit yang sudah dilaporkan"
                value={proofs.data.progress.reportedUnits}
                total={proofs.data.progress.packageQuantity}
              />
            </div>
          )}

          {proofs.data && proofs.data.items.length === 0 && (
            <EmptyState
              title="Belum ada bukti pengerjaan"
              description={
                ['SUBMITTED', 'PARTIALLY_COMPLETED', 'COMPLETED'].includes(data.status)
                  ? 'Admin sedang mengerjakan laporan Anda. Bukti akan muncul di sini.'
                  : 'Bukti muncul setelah laporan dikirim ke platform.'
              }
            />
          )}

          {proofs.data && proofs.data.items.length > 0 && (
            <ul className="grid gap-4 sm:grid-cols-2">
              {proofs.data.items.map((proof) => (
                <li key={proof.id} className="rounded-lg border border-hairline p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{PROOF_TYPE_LABEL[proof.proofType] ?? proof.proofType}</p>
                      <p className="mt-0.5 text-xs text-ink-muted">
                        Dilaporkan {formatDateTime(proof.reportedAt)}
                      </p>
                    </div>
                    {proof.unitsReported !== null && (
                      <span className="rounded-full bg-accent-50 px-2 py-0.5 text-xs font-semibold text-accent-800">
                        {formatNumber(proof.unitsReported)} unit
                      </span>
                    )}
                  </div>

                  {proof.caption && (
                    <p className="mt-2 text-sm text-ink-secondary">{proof.caption}</p>
                  )}

                  <p className="mt-2 break-all text-xs text-ink-muted">
                    {proof.fileName} · SHA-256 {proof.fileHash.slice(0, 16)}…
                  </p>

                  <Button
                    className="mt-3 w-full"
                    loading={pending}
                    onClick={() =>
                      openFile(
                        `/reports/${reportCode}/proofs/${proof.id}/download-url`,
                        proof.fileName,
                      )
                    }
                  >
                    Lihat gambar
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-4 text-xs text-ink-muted">
            Bukti pengerjaan menunjukkan laporan sudah dikirim ke platform. Ini bukan jaminan
            konten akan diturunkan — keputusan itu ada pada platform.
          </p>
        </Card>
      )}

      {/* -------------------------------------------------------------- dokumen */}
      {tab === 'dokumen' && (
        <Card
          title="Dokumen PDF"
          description="Setiap pembuatan menghasilkan versi baru; versi lama tetap tersimpan."
          actions={
            <>
              <Button loading={pending} onClick={() => requestPdf(false)}>
                Buat PDF
              </Button>
              <Button variant="primary" loading={pending} onClick={() => requestPdf(true)}>
                Buat PDF + bukti pengerjaan
              </Button>
            </>
          }
        >
          {data.documents.length === 0 ? (
            <EmptyState
              title="Belum ada dokumen"
              description="Tekan tombol di atas untuk membuat PDF. Prosesnya berjalan di latar belakang."
            />
          ) : (
            <ul className="divide-y divide-hairline">
              {data.documents.map((document) => (
                <li key={document.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {document.fileName}
                      <span className="ml-2 text-xs text-ink-muted">versi {document.version}</span>
                    </p>
                    <p className="text-xs text-ink-muted">
                      {formatDateTime(document.generatedAt)} · SHA-256{' '}
                      {document.fileHash.slice(0, 16)}…
                      {document.includesProofs && ' · memuat lampiran bukti pengerjaan'}
                    </p>
                  </div>
                  <Button
                    loading={pending}
                    onClick={() => openFile(`/documents/${document.id}/download-url`, document.fileName)}
                  >
                    Unduh
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* -------------------------------------------------------------- riwayat */}
      {tab === 'riwayat' && (
        <Card title="Riwayat status" description="Setiap perubahan status tercatat permanen.">
          <ol className="relative space-y-4 border-l border-hairline pl-6">
            {data.statusHistory.map((entry) => (
              <li key={entry.id} className="relative">
                <span
                  aria-hidden
                  className="absolute -left-[27px] top-1.5 h-2.5 w-2.5 rounded-full bg-accent-600 ring-2 ring-surface"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={entry.toStatus} size="sm" />
                  <span className="text-xs text-ink-muted">{formatDateTime(entry.occurredAt)}</span>
                </div>
                {entry.fromStatus && (
                  <p className="mt-1 text-xs text-ink-muted">
                    Dari {presentStatus(entry.fromStatus).label}
                  </p>
                )}
                {entry.reason && <p className="mt-1 text-sm text-ink-secondary">{entry.reason}</p>}
              </li>
            ))}
          </ol>
        </Card>
      )}

      {/* Pratinjau berkas lewat signed URL berumur pendek. */}
      <Modal
        open={preview !== null}
        onClose={() => setPreview(null)}
        title={preview?.name ?? ''}
        description="Tautan ini berumur maksimal 120 detik dan hanya berlaku untuk Anda."
      >
        {preview && (
          <img
            src={preview.url}
            alt={preview.name}
            className="mx-auto max-h-[60vh] w-auto rounded-lg border border-hairline"
          />
        )}
      </Modal>

      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Batalkan report ini?"
        description="Pembatalan tidak dapat dibatalkan, dan tidak ada pengembalian dana."
        footer={
          <>
            <Button onClick={() => setCancelOpen(false)}>Tidak jadi</Button>
            <Button variant="danger" loading={pending} onClick={cancelReport}>
              Ya, batalkan
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-secondary">
          Report {data.reportCode} akan ditandai dibatalkan. Datanya tetap tersimpan sebagai
          riwayat dan dapat Anda lihat kembali.
        </p>
      </Modal>
    </>
  );
}

function Row({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-4 py-2">
      <dt className="text-ink-secondary">{label}</dt>
      <dd className="max-w-[60%] text-right">{value}</dd>
    </div>
  );
}
