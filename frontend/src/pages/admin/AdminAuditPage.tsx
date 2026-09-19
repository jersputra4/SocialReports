import { Fragment, useState } from 'react';
import { PageHeader } from '../../components/Layout';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  ErrorBlock,
  Input,
  LoadingBlock,
} from '../../components/ui';
import { useApiQuery } from '../../hooks/useApi';
import { formatDateTime } from '../../lib/format';

interface AuditRow {
  seq: string;
  occurredAt: string;
  actorId: string | null;
  actorRole: string | null;
  ipAddress: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  before: unknown;
  after: unknown;
  requestId: string | null;
  prevHash: string;
  entryHash: string;
}

interface VerifyResult {
  valid: boolean;
  problems: Array<{ seq: string; auditId: string; reason: string }>;
  latest: { seq: string; hash: string } | null;
}

export default function AdminAuditPage() {
  const [action, setAction] = useState('');
  const [entityId, setEntityId] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const query = new URLSearchParams({ limit: '100' });
  if (action.trim()) query.set('action', action.trim().toUpperCase());
  if (entityId.trim()) query.set('entityId', entityId.trim());

  const logs = useApiQuery<AuditRow[]>(`/admin/audit/logs?${query.toString()}`, [action, entityId]);
  const verification = useApiQuery<VerifyResult>('/admin/audit/verify-chain');

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Catatan permanen setiap tindakan penting. Membaca halaman ini juga ikut tercatat."
        actions={
          <Button loading={verification.loading} onClick={verification.reload}>
            Verifikasi ulang rantai hash
          </Button>
        }
      />

      {verification.data && (
        <div className="mb-6">
          {verification.data.valid ? (
            <Alert tone="success" title="Rantai hash utuh">
              <p>
                Setiap entri terkait dengan entri sebelumnya lewat SHA-256. Mengubah satu baris
                saja akan memutus rantai dan langsung terdeteksi.
              </p>
              {verification.data.latest && (
                <p className="mt-1 break-all font-mono text-xs">
                  Entri terakhir #{verification.data.latest.seq} ·{' '}
                  {verification.data.latest.hash.slice(0, 32)}…
                </p>
              )}
            </Alert>
          ) : (
            <Alert tone="danger" title="Rantai hash tidak konsisten">
              <p>Ada entri yang tidak cocok dengan hash-nya. Laporkan segera ke tim keamanan.</p>
              <ul className="mt-2 list-disc pl-5">
                {verification.data.problems.map((problem) => (
                  <li key={problem.seq}>
                    Entri #{problem.seq}: {problem.reason}
                  </li>
                ))}
              </ul>
            </Alert>
          )}
        </div>
      )}

      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="aksi">
              Filter aksi
            </label>
            <Input
              id="aksi"
              value={action}
              onChange={(event) => setAction(event.target.value)}
              placeholder="mis. STATUS_CHANGE, PROOF_VOID, LOGIN"
            />
          </div>
          <div>
            <label className="label" htmlFor="entitas">
              Filter objek
            </label>
            <Input
              id="entitas"
              value={entityId}
              onChange={(event) => setEntityId(event.target.value)}
              placeholder="mis. RPT-A1B2C3D4E5"
            />
          </div>
        </div>

        {logs.loading && <LoadingBlock />}
        {logs.error && <ErrorBlock message={logs.error} onRetry={logs.reload} />}
        {logs.data && logs.data.length === 0 && (
          <EmptyState title="Tidak ada entri" description="Ubah filter untuk melihat entri lain." />
        )}

        {logs.data && logs.data.length > 0 && (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Waktu</th>
                  <th>Aksi</th>
                  <th>Objek</th>
                  <th>Aktor</th>
                  <th>Hash</th>
                </tr>
              </thead>
              <tbody>
                {logs.data.map((row) => (
                  <Fragment key={row.seq}>
                    <tr
                      className="cursor-pointer"
                      onClick={() => setExpanded(expanded === row.seq ? null : row.seq)}
                    >
                      <td className="numeric text-ink-muted">{row.seq}</td>
                      <td className="whitespace-nowrap">{formatDateTime(row.occurredAt)}</td>
                      <td className="font-medium">{row.action}</td>
                      <td>
                        <span className="text-ink-secondary">{row.entityType}</span>
                        <span className="block font-mono text-xs">{row.entityId}</span>
                      </td>
                      <td>
                        <span>{row.actorRole ?? '—'}</span>
                        <span className="block text-xs text-ink-muted">{row.ipAddress}</span>
                      </td>
                      <td className="font-mono text-xs">{row.entryHash.slice(0, 10)}…</td>
                    </tr>
                    {expanded === row.seq && (
                      <tr>
                        <td colSpan={6} className="bg-plane">
                          <div className="grid gap-4 py-2 sm:grid-cols-2">
                            <div>
                              <p className="text-xs font-semibold uppercase text-ink-muted">
                                Sebelum
                              </p>
                              <pre className="mt-1 overflow-x-auto rounded bg-surface p-2 text-xs">
                                {JSON.stringify(row.before ?? null, null, 2)}
                              </pre>
                            </div>
                            <div>
                              <p className="text-xs font-semibold uppercase text-ink-muted">
                                Sesudah
                              </p>
                              <pre className="mt-1 overflow-x-auto rounded bg-surface p-2 text-xs">
                                {JSON.stringify(row.after ?? null, null, 2)}
                              </pre>
                            </div>
                          </div>
                          <p className="break-all pb-2 font-mono text-xs text-ink-muted">
                            prev {row.prevHash} → entry {row.entryHash}
                          </p>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-4 text-xs text-ink-muted">
          Nilai sensitif seperti kata sandi, token, dan OTP diganti tanda [redacted] sebelum
          disimpan.
        </p>
      </Card>
    </>
  );
}
