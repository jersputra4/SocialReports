import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, Card, EmptyState, ErrorBlock, Input, LoadingBlock } from '../components/ui';
import { useApiQuery } from '../hooks/useApi';
import { formatDateTime } from '../lib/format';

interface Mail {
  id: string;
  to: string;
  subject: string;
  highlight: string | null;
  bodyText: string;
  createdAt: string;
}

/**
 * Kotak masuk email lokal.
 *
 * Hanya hidup ketika MAIL_DRIVER=mailbox dan bukan production. Halaman ini
 * menggantikan penyedia email saat pengembangan sehingga alur verifikasi,
 * OTP, dan reset kata sandi dapat dicoba tanpa layanan luar — dan tanpa
 * menaruh kode OTP di log aplikasi.
 */
export default function DevMailboxPage() {
  const [filter, setFilter] = useState('');
  const path = `/dev/mailbox?limit=30${filter.trim() ? `&to=${encodeURIComponent(filter.trim())}` : ''}`;
  const { data, loading, error, reload } = useApiQuery<Mail[]>(path, [filter]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Kotak masuk lokal</h1>
          <p className="mt-1 text-sm text-ink-secondary">
            Email yang dikirim sistem selama pengembangan.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={reload}>Muat ulang</Button>
          <Link to="/masuk" className="btn-secondary">
            Ke halaman masuk
          </Link>
        </div>
      </div>

      <Alert tone="warning" title="Halaman pengembangan">
        <p>
          Halaman ini menolak permintaan ketika aplikasi berjalan dengan NODE_ENV=production atau
          memakai penyedia email sungguhan.
        </p>
      </Alert>

      <div className="mt-6">
        <Card>
          <div className="mb-4">
            <label className="label" htmlFor="ke">
              Saring berdasarkan penerima
            </label>
            <Input
              id="ke"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="admin@contoh.test"
            />
          </div>

          {loading && <LoadingBlock />}
          {error && <ErrorBlock message={error} onRetry={reload} />}
          {data && data.length === 0 && (
            <EmptyState
              title="Kotak masuk kosong"
              description="Lakukan pendaftaran atau proses masuk untuk memicu email."
            />
          )}

          {data && data.length > 0 && (
            <ul className="divide-y divide-hairline">
              {data.map((mail) => (
                <li key={mail.id} className="py-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium">{mail.subject}</p>
                    <p className="text-xs text-ink-muted">{formatDateTime(mail.createdAt)}</p>
                  </div>
                  <p className="mt-0.5 text-sm text-ink-secondary">Kepada: {mail.to}</p>

                  {mail.highlight && (
                    <div className="mt-3 rounded-lg border border-accent-200 bg-accent-50/60 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-accent-800">
                        Kode / tautan
                      </p>
                      <p className="mt-1 break-all font-mono text-lg">{mail.highlight}</p>
                    </div>
                  )}

                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm text-accent-700 underline">
                      Lihat isi email
                    </summary>
                    <pre className="mt-2 whitespace-pre-wrap rounded bg-plane p-3 text-xs">
                      {mail.bodyText}
                    </pre>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
