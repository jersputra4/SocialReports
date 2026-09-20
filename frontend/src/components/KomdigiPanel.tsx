import { useState } from 'react';
import { useApiQuery, useAction } from '../hooks/useApi';
import { api } from '../lib/api';
import { formatBytes } from '../lib/format';
import { useStepUp } from './StepUpDialog';
import { Alert, Button, Card, Field, LoadingBlock, Modal, Textarea } from './ui';

interface EligibilityFinding {
  code: string;
  message: string;
}

interface ForwardPreview {
  reportCode: string;
  eligibility: {
    eligible: boolean;
    blockers: EligibilityFinding[];
    warnings: EligibilityFinding[];
    citedArticles: string[];
    cleanEvidenceCount: number;
  };
  letterNumber: string;
  attachmentCount: number;
  attachmentBytes: number;
  recipient: string;
}

/**
 * Panel penerusan aduan ke Komdigi.
 *
 * Seluruh penilaian kelayakan datang dari server lewat endpoint pratinjau;
 * tidak ada aturan yang diulang di sisi klien. Kalau aturan di backend
 * berubah, panel ini ikut berubah tanpa disunting — dan tidak mungkin ada
 * tombol yang aktif padahal server akan menolak.
 */
export function KomdigiPanel({
  reportCode,
  onForwarded,
}: {
  reportCode: string;
  onForwarded: () => void;
}) {
  const preview = useApiQuery<ForwardPreview>(
    `/admin/reports/${reportCode}/forward/komdigi/preview`,
  );
  const { run, pending, error, clearError } = useAction();
  const { run: runStepUp, dialog: stepUpDialog } = useStepUp();

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [note, setNote] = useState('');
  const [sent, setSent] = useState<string | null>(null);

  const data = preview.data;
  const eligible = data?.eligibility.eligible ?? false;

  /**
   * Dialog konfirmasi ditutup lebih dulu supaya tidak bertumpuk dengan dialog
   * OTP yang muncul setelahnya. Galat tampil di dalam kartu, bukan di dialog,
   * sehingga tetap terbaca setelah dialog tertutup.
   */
  const submit = async () => {
    clearError();
    setConfirmOpen(false);

    await run(async () => {
      await runStepUp(async () => {
        const response = await api.post<{ letterNumber: string }>(
          `/admin/reports/${reportCode}/forward/komdigi`,
          { note: note || undefined },
        );
        setSent(response.letterNumber);
        setNote('');
        preview.reload();
        onForwarded();
      }, 'Meneruskan aduan ke Komdigi');
      return true;
    });
  };

  return (
    <Card
      title="Penerusan ke Komdigi"
      description="Mengirim surat aduan resmi beserta berkas bukti ke kanal pengaduan konten."
      actions={
        <>
          {/*
            Pratinjau dibuka sebagai tautan biasa, bukan lewat klien API.
            Peramban yang merender PDF-nya, dan cookie sesi ikut terkirim
            karena endpoint-nya satu origin dengan halaman ini.
          */}
          <a
            className="btn-secondary"
            href={`/api/v1/admin/reports/${reportCode}/forward/komdigi/letter`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Lihat surat
          </a>
          <Button
            variant="primary"
            loading={pending}
            disabled={!eligible || preview.loading || pending}
            onClick={() => setConfirmOpen(true)}
          >
            Teruskan ke Komdigi
          </Button>
        </>
      }
    >
      {preview.loading && <LoadingBlock label="Memeriksa kelayakan…" />}

      {preview.error && (
        <Alert tone="danger" title="Gagal memuat pemeriksaan kelayakan">
          <p>{preview.error}</p>
        </Alert>
      )}

      {sent && (
        <div className="mb-4">
          <Alert tone="success" title="Aduan diteruskan">
            <p>Surat nomor {sent} sudah dikirim beserta lampirannya.</p>
          </Alert>
        </div>
      )}

      {error && (
        <div className="mb-4">
          <Alert tone="danger" title="Pengiriman gagal" onDismiss={clearError}>
            {error.map((message) => (
              <p key={message}>{message}</p>
            ))}
          </Alert>
        </div>
      )}

      {data && (
        <div className="space-y-4">
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Row label="Tujuan" value={data.recipient || 'Belum diatur'} />
            <Row label="Nomor surat" value={data.letterNumber} />
            <Row
              label="Lampiran bukti"
              value={`${data.attachmentCount} berkas (${formatBytes(data.attachmentBytes)})`}
            />
            <Row
              label="Pasal dikutip"
              value={
                data.eligibility.citedArticles.length > 0
                  ? data.eligibility.citedArticles.map((article) => `Pasal ${article}`).join(', ')
                  : 'Belum ada'
              }
            />
          </dl>

          {data.eligibility.blockers.length > 0 && (
            <Alert tone="danger" title={`${data.eligibility.blockers.length} penghalang`}>
              <ul className="list-disc space-y-1 pl-4">
                {data.eligibility.blockers.map((finding) => (
                  <li key={finding.code}>{finding.message}</li>
                ))}
              </ul>
            </Alert>
          )}

          {data.eligibility.warnings.length > 0 && (
            <Alert tone="warning" title={`${data.eligibility.warnings.length} peringatan`}>
              <ul className="list-disc space-y-1 pl-4">
                {data.eligibility.warnings.map((finding, index) => (
                  <li key={`${finding.code}-${index}`}>{finding.message}</li>
                ))}
              </ul>
            </Alert>
          )}

          {eligible && data.eligibility.blockers.length === 0 && (
            <Alert tone="success" title="Memenuhi syarat">
              <p>Seluruh prasyarat penerusan terpenuhi.</p>
            </Alert>
          )}
        </div>
      )}

      <Modal
        open={confirmOpen}
        title="Teruskan aduan ke Komdigi?"
        description="Tindakan ini mengirim surat resmi ke instansi dan tidak dapat ditarik kembali."
        onClose={() => setConfirmOpen(false)}
        footer={
          <>
            <Button onClick={() => setConfirmOpen(false)}>Batal</Button>
            <Button variant="primary" onClick={submit}>
              Kirim sekarang
            </Button>
          </>
        }
      >
        <div className="space-y-4 text-sm">
          <Alert tone="warning" title="Periksa sekali lagi">
            <p>
              Surat memuat nama dan surel pelapor, tautan konten, kutipan pasal, serta
              {data ? ` ${data.attachmentCount} ` : ' '}
              berkas bukti. Surat yang sudah terkirim tidak dapat dibatalkan dari sistem ini.
            </p>
          </Alert>

          <Field label="Catatan internal" hint="Disimpan pada riwayat kiriman; tidak masuk ke dalam surat.">
            <Textarea
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Opsional"
            />
          </Field>
        </div>
      </Modal>

      {stepUpDialog}
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className="text-ink-secondary">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
