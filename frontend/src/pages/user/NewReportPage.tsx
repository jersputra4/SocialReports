import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../../components/Layout';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Field,
  Input,
  LoadingBlock,
  Select,
  Textarea,
} from '../../components/ui';
import { useAction, useApiQuery } from '../../hooks/useApi';
import { api } from '../../lib/api';
import { formatBytes, formatRupiah, formatTaxRate } from '../../lib/format';

const NO_REFUND_VERSION = '1.1';
const MAX_FILE_BYTES = 5 * 1024 * 1024;

interface ActionType { id: string; code: string; name: string }
interface PackageOption {
  packageId: string;
  quantity: number;
  unitPrice: string;
  subtotal: string;
  taxName: string;
  taxRateBp: number;
  taxAmount: string;
  totalAmount: string;
}
interface PolicyOption {
  policyId: string;
  versionId: string;
  name: string;
  category: string | null;
  text: string;
}
interface LawOption { lawId: string; name: string; shortName: string | null; versionId: string; version: string }
interface ArticleOption {
  articleId: string;
  number: string;
  title: string | null;
  paragraphs: Array<{ paragraphId: string; number: string; text: string }>;
}
interface ReportDetail {
  reportCode: string;
  targetSnapshot: {
    originalUrl: string;
    platformId: string | null;
    fetchStatus: string;
    fetchError: string | null;
    metadataJson: Record<string, string> | null;
  } | null;
}

const STEPS = ['Target & paket', 'Kebijakan platform', 'Dasar hukum', 'Evidence', 'Bayar'];

export default function NewReportPage() {
  const navigate = useNavigate();
  const { run, pending, error, clearError } = useAction();

  const [step, setStep] = useState(0);
  const [reportCode, setReportCode] = useState<string | null>(null);

  // langkah 1
  const [targetUrl, setTargetUrl] = useState('');
  const [actionTypeId, setActionTypeId] = useState('');
  const [packageId, setPackageId] = useState('');
  const [description, setDescription] = useState('');

  // langkah 2
  const [policyVersionIds, setPolicyVersionIds] = useState<string[]>([]);
  const [otherPolicyReason, setOtherPolicyReason] = useState('');

  // langkah 3
  const [lawVersionId, setLawVersionId] = useState('');
  const [paragraphIds, setParagraphIds] = useState<string[]>([]);
  const [otherLegalReason, setOtherLegalReason] = useState('');

  // langkah 4
  const [files, setFiles] = useState<File[]>([]);
  const [uploaded, setUploaded] = useState<Array<{ id: string; fileName: string; fileSize: number }>>([]);

  // langkah 5
  const [consent, setConsent] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('VA_BCA');

  const actionTypes = useApiQuery<ActionType[]>('/action-types');
  const packages = useApiQuery<PackageOption[]>('/packages');
  const laws = useApiQuery<LawOption[]>('/legal/laws');

  const reportDetail = useApiQuery<ReportDetail>(reportCode ? `/reports/${reportCode}` : null, [
    reportCode,
  ]);
  const platformId = reportDetail.data?.targetSnapshot?.platformId ?? null;

  const policies = useApiQuery<PolicyOption[]>(
    platformId ? `/platforms/${platformId}/policies` : null,
    [platformId],
  );
  const articles = useApiQuery<ArticleOption[]>(
    lawVersionId ? `/legal/versions/${lawVersionId}/articles` : null,
    [lawVersionId],
  );

  useEffect(() => {
    if (!actionTypeId && actionTypes.data?.length) setActionTypeId(actionTypes.data[0].id);
  }, [actionTypes.data, actionTypeId]);

  useEffect(() => {
    if (!packageId && packages.data?.length) setPackageId(packages.data[0].packageId);
  }, [packages.data, packageId]);

  const selectedPackage = useMemo(
    () => packages.data?.find((item) => item.packageId === packageId) ?? null,
    [packages.data, packageId],
  );

  /* ------------------------------------------------------------- langkah 1 */

  const createDraft = async () => {
    clearError();
    const result = await run(() =>
      api.post<{ reportCode: string }>('/reports', {
        actionTypeId,
        packageId,
        targetUrl: targetUrl.trim(),
        description: description.trim() || undefined,
      }),
    );
    if (result) {
      setReportCode(result.reportCode);
      setStep(1);
    }
  };

  /* ------------------------------------------------------------- langkah 2 */

  const savePolicies = async () => {
    clearError();
    const selections = [
      ...policyVersionIds.map((id) => ({ policyVersionId: id })),
      ...(otherPolicyReason.trim() ? [{ otherReason: otherPolicyReason.trim() }] : []),
    ];
    const result = await run(() =>
      api.post(`/reports/${reportCode}/policies`, { policies: selections }),
    );
    if (result !== null) setStep(2);
  };

  /* ------------------------------------------------------------- langkah 3 */

  const saveLegalBasis = async () => {
    clearError();
    const selections = [
      ...paragraphIds.map((id) => ({ paragraphId: id })),
      ...(otherLegalReason.trim() ? [{ otherReason: otherLegalReason.trim() }] : []),
    ];
    const result = await run(() =>
      api.post(`/reports/${reportCode}/legal-basis`, { legalBasis: selections }),
    );
    if (result !== null) setStep(3);
  };

  /* ------------------------------------------------------------- langkah 4 */

  const uploadFiles = async () => {
    clearError();
    for (const file of files) {
      const formData = new FormData();
      formData.append('file', file);
      const result = await run(() =>
        api.upload<{ id: string; fileName: string; fileSize: number }>(
          `/reports/${reportCode}/evidences`,
          formData,
        ),
      );
      if (!result) return;
      setUploaded((current) => [...current, result]);
    }
    setFiles([]);
  };

  /* ------------------------------------------------------------- langkah 5 */

  const checkout = async () => {
    clearError();
    const result = await run(() =>
      api.post<{ gatewayOrderId: string }>(`/reports/${reportCode}/checkout`, {
        noRefundConsentVersion: NO_REFUND_VERSION,
        paymentMethod,
      }),
    );
    if (result) navigate(`/pembayaran/${result.gatewayOrderId}`);
  };

  const togglePolicy = (versionId: string) =>
    setPolicyVersionIds((current) =>
      current.includes(versionId)
        ? current.filter((id) => id !== versionId)
        : [...current, versionId],
    );

  const toggleParagraph = (paragraphId: string) =>
    setParagraphIds((current) =>
      current.includes(paragraphId)
        ? current.filter((id) => id !== paragraphId)
        : [...current, paragraphId],
    );

  const policySelectionValid = policyVersionIds.length > 0 || otherPolicyReason.trim().length >= 20;
  const legalSelectionValid = paragraphIds.length > 0 || otherLegalReason.trim().length >= 20;

  return (
    <>
      <PageHeader
        title="Buat report baru"
        description="Lima langkah: target, kebijakan yang dilanggar, dasar hukum, bukti, lalu pembayaran."
      />

      {/* Penanda langkah */}
      <ol className="mb-6 flex flex-wrap gap-2 text-sm" aria-label="Langkah pengisian">
        {STEPS.map((title, index) => {
          const state = index === step ? 'aktif' : index < step ? 'selesai' : 'berikutnya';
          return (
            <li
              key={title}
              aria-current={index === step ? 'step' : undefined}
              className={`flex items-center gap-2 rounded-full border px-3 py-1.5 ${
                index === step
                  ? 'border-accent-600 bg-accent-600 font-semibold text-white'
                  : index < step
                    ? 'border-green-200 bg-green-50 text-success'
                    : 'border-hairline bg-surface text-ink-muted'
              }`}
            >
              <span aria-hidden>{index < step ? '✓' : index + 1}</span>
              <span>{title}</span>
              <span className="sr-only">({state})</span>
            </li>
          );
        })}
      </ol>

      {error && (
        <div className="mb-4">
          <Alert tone="danger" title="Belum dapat dilanjutkan" onDismiss={clearError}>
            {error.map((message) => (
              <p key={message}>{message}</p>
            ))}
          </Alert>
        </div>
      )}

      {/* ---------------------------------------------------------- langkah 1 */}
      {step === 0 && (
        <Card title="Target dan paket">
          <div className="space-y-5">
            <Field
              label="Tautan konten atau akun"
              required
              hint="Didukung: Facebook, Instagram, TikTok, X, dan YouTube. Tautan pendek akan diikuti maksimal tiga kali."
            >
              <Input
                value={targetUrl}
                onChange={(event) => setTargetUrl(event.target.value)}
                placeholder="https://www.instagram.com/p/…"
                inputMode="url"
              />
            </Field>

            <Field label="Jenis tindakan" required>
              <Select value={actionTypeId} onChange={(event) => setActionTypeId(event.target.value)}>
                {actionTypes.data?.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </Field>

            <fieldset>
              <legend className="label">Paket unit report</legend>
              {packages.loading && <LoadingBlock label="Memuat harga…" />}
              <div className="grid gap-3 sm:grid-cols-2">
                {packages.data?.map((option) => (
                  <label
                    key={option.packageId}
                    className={`flex cursor-pointer gap-3 rounded-lg border p-4 ${
                      packageId === option.packageId
                        ? 'border-accent-600 ring-2 ring-accent-200'
                        : 'border-hairline hover:border-baseline'
                    }`}
                  >
                    <input
                      type="radio"
                      name="paket"
                      className="mt-1 h-4 w-4"
                      checked={packageId === option.packageId}
                      onChange={() => setPackageId(option.packageId)}
                    />
                    <span className="min-w-0">
                      <span className="block font-semibold">{option.quantity} unit</span>
                      <span className="mt-1 block text-sm text-ink-secondary">
                        {formatRupiah(option.subtotal)} + {option.taxName}{' '}
                        {formatTaxRate(option.taxRateBp)} {formatRupiah(option.taxAmount)}
                      </span>
                      <span className="mt-1 block font-semibold">
                        Total {formatRupiah(option.totalAmount)}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <Field label="Keterangan tambahan" hint="Opsional, maksimal 2000 karakter.">
              <Textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={2000}
                placeholder="Jelaskan singkat apa yang terjadi dan mengapa konten ini dilaporkan."
              />
            </Field>

            <div className="flex justify-end">
              <Button
                variant="primary"
                loading={pending}
                disabled={!targetUrl.trim() || !actionTypeId || !packageId}
                onClick={createDraft}
              >
                Simpan dan lanjut
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* ---------------------------------------------------------- langkah 2 */}
      {step === 1 && (
        <Card
          title="Kebijakan platform yang dilanggar"
          description="Pilih satu atau lebih. Teks kebijakan akan disalin ke report dan dikunci."
        >
          {reportDetail.data?.targetSnapshot?.fetchStatus === 'FAILED' && (
            <div className="mb-4">
              <Alert tone="warning" title="Metadata target tidak dapat diambil">
                <p>
                  Sistem tidak berhasil membaca pratinjau konten
                  {reportDetail.data.targetSnapshot.fetchError
                    ? `: ${reportDetail.data.targetSnapshot.fetchError}`
                    : '.'}{' '}
                  Report tetap dapat dilanjutkan — jelaskan sendiri isinya pada keterangan.
                </p>
              </Alert>
            </div>
          )}

          {policies.loading && <LoadingBlock label="Memuat kebijakan platform…" />}

          <div className="space-y-3">
            {policies.data?.map((policy) => (
              <label
                key={policy.versionId}
                className={`flex cursor-pointer gap-3 rounded-lg border p-4 ${
                  policyVersionIds.includes(policy.versionId)
                    ? 'border-accent-600 ring-2 ring-accent-200'
                    : 'border-hairline hover:border-baseline'
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked={policyVersionIds.includes(policy.versionId)}
                  onChange={() => togglePolicy(policy.versionId)}
                />
                <span>
                  <span className="block font-semibold">{policy.name}</span>
                  {policy.category && (
                    <span className="mt-0.5 block text-xs uppercase tracking-wide text-ink-muted">
                      {policy.category}
                    </span>
                  )}
                  <span className="mt-1 block text-sm text-ink-secondary">{policy.text}</span>
                </span>
              </label>
            ))}
          </div>

          <div className="mt-5">
            <Field
              label="Lainnya"
              hint="Isi bila pelanggarannya tidak tercakup daftar di atas. Minimal 20 karakter."
            >
              <Textarea
                value={otherPolicyReason}
                onChange={(event) => setOtherPolicyReason(event.target.value)}
                maxLength={2000}
                rows={3}
              />
            </Field>
          </div>

          <div className="mt-5 flex justify-between">
            <Button onClick={() => setStep(0)}>Kembali</Button>
            <Button
              variant="primary"
              loading={pending}
              disabled={!policySelectionValid}
              onClick={savePolicies}
            >
              Simpan dan lanjut
            </Button>
          </div>
        </Card>
      )}

      {/* ---------------------------------------------------------- langkah 3 */}
      {step === 2 && (
        <Card
          title="Dasar hukum"
          description="Pilih pasal dan ayat yang relevan. Teksnya akan disalin ke report dan dikunci."
        >
          <Field label="Peraturan" required>
            <Select value={lawVersionId} onChange={(event) => setLawVersionId(event.target.value)}>
              <option value="">— Pilih peraturan —</option>
              {laws.data?.map((law) => (
                <option key={law.versionId} value={law.versionId}>
                  {law.shortName ?? law.name} ({law.version})
                </option>
              ))}
            </Select>
          </Field>

          {articles.loading && <LoadingBlock label="Memuat pasal…" />}

          {articles.data && (
            <div className="mt-4 space-y-4">
              {articles.data.map((article) => (
                <div key={article.articleId} className="rounded-lg border border-hairline p-4">
                  <p className="font-semibold">
                    Pasal {article.number}
                    {article.title ? ` — ${article.title}` : ''}
                  </p>
                  <div className="mt-3 space-y-2">
                    {article.paragraphs.map((paragraph) => (
                      <label
                        key={paragraph.paragraphId}
                        className="flex cursor-pointer gap-3 rounded-md p-2 hover:bg-plane"
                      >
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4"
                          checked={paragraphIds.includes(paragraph.paragraphId)}
                          onChange={() => toggleParagraph(paragraph.paragraphId)}
                        />
                        <span className="text-sm">
                          <span className="font-medium">Ayat {paragraph.number}</span>
                          <span className="mt-0.5 block text-ink-secondary">{paragraph.text}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-5">
            <Field
              label="Lainnya"
              hint="Isi bila dasar hukumnya tidak tercakup daftar di atas. Minimal 20 karakter."
            >
              <Textarea
                value={otherLegalReason}
                onChange={(event) => setOtherLegalReason(event.target.value)}
                maxLength={2000}
                rows={3}
              />
            </Field>
          </div>

          <Alert tone="info">
            <p>
              Pemilihan dasar hukum bukan penetapan bahwa konten pasti melanggar hukum. Penilaian
              akhir tetap ada pada pihak yang berwenang.
            </p>
          </Alert>

          <div className="mt-5 flex justify-between">
            <Button onClick={() => setStep(1)}>Kembali</Button>
            <Button
              variant="primary"
              loading={pending}
              disabled={!legalSelectionValid}
              onClick={saveLegalBasis}
            >
              Simpan dan lanjut
            </Button>
          </div>
        </Card>
      )}

      {/* ---------------------------------------------------------- langkah 4 */}
      {step === 3 && (
        <Card
          title="Evidence"
          description="Tangkapan layar konten yang dilaporkan. PNG, JPEG, atau WebP, maksimal 5 MB per berkas."
        >
          <Alert tone="info" title="Sebelum mengunggah">
            <p>
              Tutupi data pribadi pihak lain yang tidak berkaitan dengan laporan. Data lokasi pada
              foto (EXIF) otomatis dibuang oleh sistem.
            </p>
          </Alert>

          <div className="mt-4">
            <Field label="Pilih berkas">
              <input
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp"
                className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-accent-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-accent-700"
                onChange={(event) => {
                  const picked = Array.from(event.target.files ?? []);
                  setFiles(picked.filter((file) => file.size <= MAX_FILE_BYTES));
                }}
              />
            </Field>
          </div>

          {files.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm">
              {files.map((file) => (
                <li key={file.name} className="flex justify-between gap-3">
                  <span className="truncate">{file.name}</span>
                  <span className="text-ink-muted">{formatBytes(file.size)}</span>
                </li>
              ))}
            </ul>
          )}

          {files.length > 0 && (
            <div className="mt-3">
              <Button variant="primary" loading={pending} onClick={uploadFiles}>
                Unggah {files.length} berkas
              </Button>
            </div>
          )}

          {uploaded.length > 0 && (
            <div className="mt-5">
              <p className="text-sm font-medium">Sudah terunggah</p>
              <ul className="mt-2 space-y-1 text-sm">
                {uploaded.map((item) => (
                  <li key={item.id} className="flex justify-between gap-3">
                    <span className="truncate">✓ {item.fileName}</span>
                    <span className="text-ink-muted">{formatBytes(item.fileSize)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-5 flex justify-between">
            <Button onClick={() => setStep(2)}>Kembali</Button>
            <Button variant="primary" onClick={() => setStep(4)}>
              {uploaded.length === 0 ? 'Lanjut tanpa evidence' : 'Lanjut ke pembayaran'}
            </Button>
          </div>
        </Card>
      )}

      {/* ---------------------------------------------------------- langkah 5 */}
      {step === 4 && (
        <Card title="Ringkasan dan pembayaran">
          <dl className="divide-y divide-hairline text-sm">
            <div className="flex justify-between gap-4 py-2">
              <dt className="text-ink-secondary">Kode report</dt>
              <dd className="font-mono font-semibold">{reportCode}</dd>
            </div>
            <div className="flex justify-between gap-4 py-2">
              <dt className="text-ink-secondary">Target</dt>
              <dd className="max-w-[60%] truncate text-right">{targetUrl}</dd>
            </div>
            <div className="flex justify-between gap-4 py-2">
              <dt className="text-ink-secondary">Paket</dt>
              <dd>{selectedPackage?.quantity} unit</dd>
            </div>
            <div className="flex justify-between gap-4 py-2">
              <dt className="text-ink-secondary">Evidence terunggah</dt>
              <dd>{uploaded.length} berkas</dd>
            </div>
            <div className="flex justify-between gap-4 py-2">
              <dt className="text-ink-secondary">Subtotal</dt>
              <dd className="numeric">{formatRupiah(selectedPackage?.subtotal ?? null)}</dd>
            </div>
            <div className="flex justify-between gap-4 py-2">
              <dt className="text-ink-secondary">
                {selectedPackage?.taxName} {formatTaxRate(selectedPackage?.taxRateBp ?? null)}
              </dt>
              <dd className="numeric">{formatRupiah(selectedPackage?.taxAmount ?? null)}</dd>
            </div>
            <div className="flex justify-between gap-4 py-3">
              <dt className="font-semibold">Total tagihan</dt>
              <dd className="numeric text-lg font-semibold">
                {formatRupiah(selectedPackage?.totalAmount ?? null)}
              </dd>
            </div>
          </dl>

          <div className="mt-4">
            <Field label="Metode pembayaran">
              <Select
                value={paymentMethod}
                onChange={(event) => setPaymentMethod(event.target.value)}
              >
                <option value="VA_MANDIRI">Virtual Account Mandiri</option>
                <option value="VA_BRI">Virtual Account BRI</option>
                <option value="VA_BNI">Virtual Account BNI</option>
                <option value="GOPAY">GoPay</option>
                <option value="DANA">DANA</option>
                <option value="SHOPEEPAY">ShopeePay</option>
              </Select>
            </Field>
          </div>

          <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4">
            <Checkbox
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
              label="Saya memahami pembayaran tidak dapat dikembalikan"
              description={
                <>
                  Sistem hanya membuat dan mendokumentasikan laporan; keputusan penurunan konten
                  ada pada platform. Karena itu tidak ada pengembalian dana dalam keadaan apa pun.
                  Bila report perlu diperbaiki, tersedia jalur perbaikan tanpa pembayaran baru.
                </>
              }
            />
          </div>

          <div className="mt-5 flex justify-between">
            <Button onClick={() => setStep(3)}>Kembali</Button>
            <Button variant="primary" loading={pending} disabled={!consent} onClick={checkout}>
              Buat tagihan
            </Button>
          </div>
        </Card>
      )}
    </>
  );
}
