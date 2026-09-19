import { ReactNode, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '../../components/Layout';
import { ProgressMeter } from '../../components/Stats';
import { StatusBadge } from '../../components/StatusBadge';
import { useStepUp } from '../../components/StepUpDialog';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  Modal,
  Select,
  Textarea,
} from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useAction, useApiQuery } from '../../hooks/useApi';
import { api } from '../../lib/api';
import { formatBytes, formatDateTime, formatNumber, formatRupiah, formatTaxRate } from '../../lib/format';
import { CHANNEL_LABEL, PROOF_TYPE_LABEL, presentStatus } from '../../lib/status';

interface AdminReportDetail {
  reportCode: string;
  status: string;
  description: string | null;
  packageQuantity: number;
  createdAt: string;
  platformNameSnapshot: string | null;
  subtotalSnapshot: string | null;
  taxRateBpSnapshot: number | null;
  taxAmountSnapshot: string | null;
  totalAmountSnapshot: string | null;
  actionType: { name: string };
  user: { email: string; fullName: string };
  targetSnapshot: { originalUrl: string; canonicalUrl: string | null; fetchStatus: string } | null;
  policies: Array<{ id: string; nameSnapshot: string; textSnapshot: string | null; otherReason: string | null }>;
  legalBasis: Array<{
    id: string;
    lawNameSnapshot: string;
    articleNumberSnapshot: string | null;
    paragraphNumberSnapshot: string | null;
    textSnapshot: string | null;
    otherReason: string | null;
  }>;
  evidences: Array<{ id: string; fileName: string; fileSize: number; fileHash: string; createdAt: string }>;
  statusHistory: Array<{ id: string; fromStatus: string | null; toStatus: string; reason: string | null; occurredAt: string }>;
  reviewDecisions: Array<{ id: string; decision: string; reason: string; decidedAt: string }>;
  complaints: Array<{ id: string; channel: string; submittedAt: string; externalReference: string | null; notes: string | null }>;
  availableActions: { admin: string[]; reviewer: string[]; finance: string[] };
}

interface AdminProof {
  id: string;
  proofType: string;
  reportedAt: string;
  caption: string | null;
  unitsReported: number | null;
  fileName: string;
  fileSize: number;
  fileHash: string;
  visibleToUser: boolean;
  isVoided: boolean;
  uploadedBy: string;
  voidedBy: string | null;
  voidReason: string | null;
  createdAt: string;
}

const MAX_FILE_BYTES = 5 * 1024 * 1024;

export default function AdminReportDetailPage() {
  const { reportCode = '' } = useParams();
  const { can } = useAuth();
  const { run: runStepUp, dialog: stepUpDialog } = useStepUp();

  const report = useApiQuery<AdminReportDetail>(`/admin/reports/${reportCode}`, [reportCode]);
  const proofs = useApiQuery<AdminProof[]>(
    can('report.fulfill') ? `/admin/reports/${reportCode}/proofs` : null,
    [reportCode],
  );
  const { run, pending, error, clearError } = useAction();

  const [reviewOpen, setReviewOpen] = useState(false);
  const [decision, setDecision] = useState<'APPROVED' | 'REJECTED' | 'NEEDS_REVISION'>('APPROVED');
  const [reviewReason, setReviewReason] = useState('');

  const [submitOpen, setSubmitOpen] = useState(false);
  const [channel, setChannel] = useState('IN_APP_FORM');
  const [externalReference, setExternalReference] = useState('');
  const [submitNotes, setSubmitNotes] = useState('');

  const [proofOpen, setProofOpen] = useState(false);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofType, setProofType] = useState('POST_REPORTED');
  const [reportedAt, setReportedAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [caption, setCaption] = useState('');
  const [unitsReported, setUnitsReported] = useState('');
  const [visibleToUser, setVisibleToUser] = useState(true);

  const [voidTarget, setVoidTarget] = useState<AdminProof | null>(null);
  const [voidReason, setVoidReason] = useState('');

  const [failOpen, setFailOpen] = useState(false);
  const [failReason, setFailReason] = useState('');

  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);

  if (report.loading) return <LoadingBlock />;
  if (report.error) return <ErrorBlock message={report.error} onRetry={report.reload} />;
  if (!report.data) return null;

  const data = report.data;
  const adminActions = data.availableActions.admin;
  const reviewerActions = data.availableActions.reviewer;

  const reloadAll = () => {
    report.reload();
    proofs.reload();
  };

  const openFile = async (path: string, name: string) => {
    const result = await run(() => api.get<{ url: string }>(path));
    if (result) setPreview({ url: result.url, name });
  };

  const submitReview = async () => {
    const result = await run(() =>
      api.post(`/admin/reports/${reportCode}/review`, { decision, reason: reviewReason }),
    );
    if (result !== null) {
      setReviewOpen(false);
      setReviewReason('');
      reloadAll();
    }
  };

  const submitToPlatform = async () => {
    const result = await run(() =>
      api.post(`/admin/reports/${reportCode}/submissions`, {
        channel,
        externalReference: externalReference || undefined,
        notes: submitNotes || undefined,
      }),
    );
    if (result !== null) {
      setSubmitOpen(false);
      setExternalReference('');
      setSubmitNotes('');
      reloadAll();
    }
  };

  const uploadProof = async () => {
    if (!proofFile) return;
    const formData = new FormData();
    formData.append('file', proofFile);
    formData.append('proofType', proofType);
    formData.append('reportedAt', new Date(reportedAt).toISOString());
    if (caption) formData.append('caption', caption);
    if (unitsReported) formData.append('unitsReported', unitsReported);
    formData.append('visibleToUser', String(visibleToUser));

    const result = await run(() => api.upload(`/admin/reports/${reportCode}/proofs`, formData));
    if (result !== null) {
      setProofOpen(false);
      setProofFile(null);
      setCaption('');
      setUnitsReported('');
      reloadAll();
    }
  };

  const voidProof = async () => {
    if (!voidTarget) return;
    clearError();
    await runStepUp(async () => {
      await api.post(`/admin/reports/${reportCode}/proofs/${voidTarget.id}/void`, {
        reason: voidReason,
      });
      setVoidTarget(null);
      setVoidReason('');
      reloadAll();
    }, 'Membatalkan bukti pengerjaan');
  };

  const transition = async (path: string, body?: unknown) => {
    const result = await run(() => api.post(`/admin/reports/${reportCode}/${path}`, body ?? {}));
    if (result !== null) reloadAll();
  };

  const activeProofs = (proofs.data ?? []).filter((proof) => !proof.isVoided && proof.visibleToUser);
  const reportedUnits = activeProofs.reduce((sum, proof) => sum + (proof.unitsReported ?? 0), 0);
  const hasUnitData = activeProofs.some((proof) => proof.unitsReported !== null);

  return (
    <>
      <PageHeader
        title={data.reportCode}
        description={presentStatus(data.status).description}
        actions={
          <Link to="/admin/report" className="btn-ghost">
            Kembali
          </Link>
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
          {data.user.fullName} · {data.user.email}
        </span>
      </div>

      {/* Tindakan yang tersedia diambil dari state machine di server, bukan
          ditebak di sisi klien — tombol yang muncul pasti diizinkan. */}
      <Card title="Tindakan" className="mb-6">
        <div className="flex flex-wrap gap-2">
          {reviewerActions.some((action) =>
            ['APPROVED', 'REJECTED', 'NEEDS_REVISION'].includes(action),
          ) &&
            can('report.review') && (
              <Button variant="primary" onClick={() => setReviewOpen(true)}>
                Putuskan review
              </Button>
            )}

          {adminActions.includes('SUBMITTED') && can('report.fulfill') && (
            <Button variant="primary" onClick={() => setSubmitOpen(true)}>
              {data.status === 'FAILED' ? 'Coba lapor ulang' : 'Catat pelaporan ke platform'}
            </Button>
          )}

          {['SUBMITTED', 'PARTIALLY_COMPLETED'].includes(data.status) && can('report.fulfill') && (
            <Button onClick={() => setProofOpen(true)}>Unggah bukti pengerjaan</Button>
          )}

          {adminActions.includes('PARTIALLY_COMPLETED') && can('report.fulfill') && (
            <Button loading={pending} onClick={() => transition('mark-partially-completed')}>
              Tandai selesai sebagian
            </Button>
          )}

          {adminActions.includes('COMPLETED') && can('report.fulfill') && (
            <Button variant="primary" loading={pending} onClick={() => transition('mark-completed')}>
              Tandai selesai
            </Button>
          )}

          {adminActions.includes('FAILED') && can('report.fulfill') && (
            <Button variant="danger" onClick={() => setFailOpen(true)}>
              Tandai gagal
            </Button>
          )}

          {adminActions.includes('ARCHIVED') && can('report.fulfill') && (
            <Button loading={pending} onClick={() => transition('archive')}>
              Arsipkan
            </Button>
          )}

          {adminActions.length === 0 && reviewerActions.length === 0 && (
            <p className="text-sm text-ink-secondary">
              Tidak ada tindakan yang tersedia pada status ini.
            </p>
          )}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Target dan isi report">
            <dl className="divide-y divide-hairline text-sm">
              <Row label="Platform" value={data.platformNameSnapshot ?? '—'} />
              <Row label="Jenis tindakan" value={data.actionType.name} />
              <Row
                label="URL target"
                value={<span className="break-all">{data.targetSnapshot?.originalUrl ?? '—'}</span>}
              />
              <Row label="Paket" value={`${formatNumber(data.packageQuantity)} unit`} />
              {data.description && <Row label="Keterangan pelapor" value={data.description} />}
            </dl>

            <h3 className="mt-5 text-sm font-semibold">Kebijakan yang dilanggar</h3>
            <ol className="mt-2 space-y-3 text-sm">
              {data.policies.map((policy, index) => (
                <li key={policy.id}>
                  <p className="font-medium">
                    {index + 1}. {policy.nameSnapshot}
                  </p>
                  {policy.textSnapshot && (
                    <p className="mt-1 border-l-2 border-hairline pl-3 text-ink-secondary">
                      {policy.textSnapshot}
                    </p>
                  )}
                  {policy.otherReason && (
                    <p className="mt-1 text-ink-secondary">{policy.otherReason}</p>
                  )}
                </li>
              ))}
            </ol>

            <h3 className="mt-5 text-sm font-semibold">Dasar hukum</h3>
            <ol className="mt-2 space-y-3 text-sm">
              {data.legalBasis.map((legal, index) => (
                <li key={legal.id}>
                  <p className="font-medium">
                    {index + 1}. {legal.lawNameSnapshot}
                    {legal.articleNumberSnapshot && ` — Pasal ${legal.articleNumberSnapshot}`}
                    {legal.paragraphNumberSnapshot && ` Ayat ${legal.paragraphNumberSnapshot}`}
                  </p>
                  {legal.textSnapshot && (
                    <p className="mt-1 border-l-2 border-hairline pl-3 text-ink-secondary">
                      {legal.textSnapshot}
                    </p>
                  )}
                  {legal.otherReason && (
                    <p className="mt-1 text-ink-secondary">{legal.otherReason}</p>
                  )}
                </li>
              ))}
            </ol>
          </Card>

          <Card title="Evidence dari pelapor">
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
                    </div>
                    <Button
                      loading={pending}
                      onClick={() =>
                        openFile(`/evidences/${evidence.id}/download-url`, evidence.fileName)
                      }
                    >
                      Lihat
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {can('report.fulfill') && (
            <Card
              title="Bukti pengerjaan"
              description="Bukti yang di-void tetap terlihat di sini beserta alasannya."
              actions={
                ['SUBMITTED', 'PARTIALLY_COMPLETED'].includes(data.status) && (
                  <Button variant="primary" onClick={() => setProofOpen(true)}>
                    Unggah bukti
                  </Button>
                )
              }
            >
              {hasUnitData && (
                <div className="mb-4 rounded-lg border border-hairline p-4">
                  <ProgressMeter
                    label="Unit yang sudah tercakup bukti aktif"
                    value={reportedUnits}
                    total={data.packageQuantity}
                  />
                </div>
              )}

              {proofs.loading && <LoadingBlock />}
              {proofs.data && proofs.data.length === 0 && (
                <EmptyState title="Belum ada bukti pengerjaan" />
              )}

              {proofs.data && proofs.data.length > 0 && (
                <ul className="divide-y divide-hairline">
                  {proofs.data.map((proof) => (
                    <li key={proof.id} className="py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium">
                            {PROOF_TYPE_LABEL[proof.proofType] ?? proof.proofType}
                            {proof.isVoided && (
                              <span className="ml-2 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-900">
                                ✕ Di-void
                              </span>
                            )}
                            {!proof.visibleToUser && !proof.isVoided && (
                              <span className="ml-2 rounded-full border border-baseline bg-plane px-2 py-0.5 text-xs text-ink-secondary">
                                Disembunyikan dari user
                              </span>
                            )}
                          </p>
                          <p className="mt-0.5 text-xs text-ink-muted">
                            Dilaporkan {formatDateTime(proof.reportedAt)} · diunggah{' '}
                            {proof.uploadedBy}
                            {proof.unitsReported !== null &&
                              ` · ${formatNumber(proof.unitsReported)} unit`}
                          </p>
                          {proof.caption && (
                            <p className="mt-1 text-sm text-ink-secondary">{proof.caption}</p>
                          )}
                          {proof.isVoided && (
                            <p className="mt-1 text-sm text-red-900">
                              Alasan void: {proof.voidReason} (oleh {proof.voidedBy})
                            </p>
                          )}
                          <p className="mt-1 break-all text-xs text-ink-muted">
                            {proof.fileName} · SHA-256 {proof.fileHash.slice(0, 16)}…
                          </p>
                        </div>

                        <div className="flex gap-2">
                          <Button
                            loading={pending}
                            onClick={() =>
                              openFile(
                                `/reports/${reportCode}/proofs/${proof.id}/download-url`,
                                proof.fileName,
                              )
                            }
                          >
                            Lihat
                          </Button>
                          {!proof.isVoided && (
                            <Button variant="danger" onClick={() => setVoidTarget(proof)}>
                              Void
                            </Button>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card title="Biaya">
            <dl className="divide-y divide-hairline text-sm">
              <Row label="Subtotal" value={formatRupiah(data.subtotalSnapshot)} />
              <Row
                label={`PPN ${formatTaxRate(data.taxRateBpSnapshot)}`}
                value={formatRupiah(data.taxAmountSnapshot)}
              />
              <Row
                label={<span className="font-semibold">Total</span>}
                value={<span className="font-semibold">{formatRupiah(data.totalAmountSnapshot)}</span>}
              />
            </dl>
          </Card>

          <Card title="Keputusan review">
            {data.reviewDecisions.length === 0 ? (
              <p className="text-sm text-ink-secondary">Belum ada keputusan.</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {data.reviewDecisions.map((item) => (
                  <li key={item.id} className="rounded-lg border border-hairline p-3">
                    <StatusBadge status={item.decision} size="sm" />
                    <p className="mt-2 text-ink-secondary">{item.reason}</p>
                    <p className="mt-1 text-xs text-ink-muted">{formatDateTime(item.decidedAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Pelaporan ke platform">
            {data.complaints.length === 0 ? (
              <p className="text-sm text-ink-secondary">Belum dilaporkan.</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {data.complaints.map((item) => (
                  <li key={item.id} className="rounded-lg border border-hairline p-3">
                    <p className="font-medium">{CHANNEL_LABEL[item.channel] ?? item.channel}</p>
                    <p className="mt-1 text-xs text-ink-muted">{formatDateTime(item.submittedAt)}</p>
                    {item.externalReference && (
                      <p className="mt-1 font-mono text-xs">Ref: {item.externalReference}</p>
                    )}
                    {item.notes && <p className="mt-1 text-ink-secondary">{item.notes}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Riwayat status">
            <ol className="space-y-3 text-sm">
              {data.statusHistory
                .slice()
                .reverse()
                .map((entry) => (
                  <li key={entry.id}>
                    <StatusBadge status={entry.toStatus} size="sm" />
                    <p className="mt-1 text-xs text-ink-muted">{formatDateTime(entry.occurredAt)}</p>
                    {entry.reason && (
                      <p className="mt-1 text-ink-secondary">{entry.reason}</p>
                    )}
                  </li>
                ))}
            </ol>
          </Card>
        </div>
      </div>

      {/* ------------------------------------------------------------ review */}
      <Modal
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        title="Keputusan review"
        description="Alasan wajib diisi dan akan tersimpan permanen di riwayat serta audit log."
        footer={
          <>
            <Button onClick={() => setReviewOpen(false)}>Batal</Button>
            <Button
              variant="primary"
              loading={pending}
              disabled={reviewReason.trim().length < 10}
              onClick={submitReview}
            >
              Simpan keputusan
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Keputusan" required>
            <Select
              value={decision}
              onChange={(event) => setDecision(event.target.value as typeof decision)}
            >
              <option value="APPROVED">Setujui — layak dilaporkan</option>
              <option value="NEEDS_REVISION">Minta perbaikan — tanpa pembayaran baru</option>
              <option value="REJECTED">Tolak — status final</option>
            </Select>
          </Field>

          <Field
            label="Alasan"
            required
            hint="Minimal 10 karakter. Pelapor akan membacanya bila keputusan meminta perbaikan."
          >
            <Textarea
              value={reviewReason}
              onChange={(event) => setReviewReason(event.target.value)}
              rows={5}
              placeholder={
                decision === 'NEEDS_REVISION'
                  ? 'Sebutkan dengan jelas apa yang perlu diperbaiki.'
                  : 'Jelaskan dasar keputusan ini.'
              }
            />
          </Field>

          {decision === 'REJECTED' && (
            <Alert tone="warning">
              <p>Penolakan bersifat final dan tidak disertai pengembalian dana.</p>
            </Alert>
          )}
        </div>
      </Modal>

      {/* -------------------------------------------------- catat pelaporan */}
      <Modal
        open={submitOpen}
        onClose={() => setSubmitOpen(false)}
        title="Catat pelaporan ke platform"
        description="Report hanya dapat berpindah ke SUBMITTED bila pencatatan ini ada."
        footer={
          <>
            <Button onClick={() => setSubmitOpen(false)}>Batal</Button>
            <Button variant="primary" loading={pending} onClick={submitToPlatform}>
              Simpan dan tandai dilaporkan
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Kanal pelaporan" required>
            <Select value={channel} onChange={(event) => setChannel(event.target.value)}>
              {Object.entries(CHANNEL_LABEL).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Nomor acuan dari platform" hint="Opsional, bila platform memberikannya.">
            <Input
              value={externalReference}
              onChange={(event) => setExternalReference(event.target.value)}
            />
          </Field>

          <Field label="Catatan internal">
            <Textarea
              value={submitNotes}
              onChange={(event) => setSubmitNotes(event.target.value)}
              rows={3}
            />
          </Field>
        </div>
      </Modal>

      {/* ------------------------------------------------------ unggah bukti */}
      <Modal
        open={proofOpen}
        onClose={() => setProofOpen(false)}
        title="Unggah bukti pengerjaan"
        description="Tangkapan layar yang menunjukkan postingan atau akun sudah dilaporkan."
        footer={
          <>
            <Button onClick={() => setProofOpen(false)}>Batal</Button>
            <Button variant="primary" loading={pending} disabled={!proofFile} onClick={uploadProof}>
              Unggah
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Alert tone="warning" title="Sebelum mengunggah">
            <p>
              Potong atau samarkan data pribadi pihak lain pada tangkapan layar. Berkas disimpan
              permanen dan dapat dilihat pelapor.
            </p>
          </Alert>

          <Field label="Gambar" required hint="PNG, JPEG, atau WebP. Maksimal 5 MB.">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-accent-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                setProofFile(file && file.size <= MAX_FILE_BYTES ? file : null);
              }}
            />
          </Field>

          <Field label="Jenis bukti" required>
            <Select value={proofType} onChange={(event) => setProofType(event.target.value)}>
              {Object.entries(PROOF_TYPE_LABEL).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Waktu pelaporan dilakukan"
            required
            hint="Tidak boleh di masa depan dan tidak boleh sebelum report disetujui."
          >
            <Input
              type="datetime-local"
              value={reportedAt}
              onChange={(event) => setReportedAt(event.target.value)}
            />
          </Field>

          <Field label="Keterangan" hint="Maksimal 500 karakter.">
            <Textarea
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
              maxLength={500}
              rows={3}
            />
          </Field>

          <Field
            label="Jumlah unit tercakup"
            hint="Opsional. Dipakai menghitung progres dan status selesai sebagian."
          >
            <Input
              value={unitsReported}
              onChange={(event) => setUnitsReported(event.target.value.replace(/\D/g, ''))}
              inputMode="numeric"
              placeholder={String(data.packageQuantity)}
            />
          </Field>

          <Checkbox
            checked={visibleToUser}
            onChange={(event) => setVisibleToUser(event.target.checked)}
            label="Tampilkan ke pelapor"
            description="Bukti yang disembunyikan tidak dapat dipakai untuk menandai report selesai."
          />
        </div>
      </Modal>

      {/* --------------------------------------------------------- void bukti */}
      <Modal
        open={voidTarget !== null}
        onClose={() => setVoidTarget(null)}
        title="Void bukti pengerjaan"
        description="Bukti tidak dihapus — hanya disembunyikan dari pelapor, dengan alasan tercatat."
        footer={
          <>
            <Button onClick={() => setVoidTarget(null)}>Batal</Button>
            <Button
              variant="danger"
              loading={pending}
              disabled={voidReason.trim().length < 10}
              onClick={voidProof}
            >
              Void bukti
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Alert tone="info">
            <p>Tindakan ini meminta verifikasi OTP ulang sebelum dijalankan.</p>
          </Alert>
          <Field label="Alasan void" required hint="Minimal 10 karakter.">
            <Textarea
              value={voidReason}
              onChange={(event) => setVoidReason(event.target.value)}
              rows={4}
            />
          </Field>
        </div>
      </Modal>

      {/* -------------------------------------------------------- tandai gagal */}
      <Modal
        open={failOpen}
        onClose={() => setFailOpen(false)}
        title="Tandai pelaporan gagal"
        footer={
          <>
            <Button onClick={() => setFailOpen(false)}>Batal</Button>
            <Button
              variant="danger"
              loading={pending}
              disabled={failReason.trim().length < 10}
              onClick={async () => {
                await transition('mark-failed', { reason: failReason });
                setFailOpen(false);
                setFailReason('');
              }}
            >
              Tandai gagal
            </Button>
          </>
        }
      >
        <Field label="Alasan" required hint="Minimal 10 karakter.">
          <Textarea value={failReason} onChange={(event) => setFailReason(event.target.value)} rows={4} />
        </Field>
      </Modal>

      <Modal
        open={preview !== null}
        onClose={() => setPreview(null)}
        title={preview?.name ?? ''}
        description="Tautan berumur maksimal 120 detik."
      >
        {preview && (
          <img
            src={preview.url}
            alt={preview.name}
            className="mx-auto max-h-[60vh] w-auto rounded-lg border border-hairline"
          />
        )}
      </Modal>

      {stepUpDialog}
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
