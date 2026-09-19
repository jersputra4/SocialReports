import { useState } from 'react';
import { PageHeader } from '../../components/Layout';
import { StatTile } from '../../components/Stats';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  Select,
} from '../../components/ui';
import { useAction, useApiQuery } from '../../hooks/useApi';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';

interface Stats {
  pending: number;
  failed: number;
  dead: number;
  oldestBacklogSeconds: number;
  alerting: boolean;
  maxAttempts: number;
}

interface OutboxEvent {
  id: string;
  eventType: string;
  status: string;
  attempts: number;
  nextAttemptAt: string;
  lastError: string | null;
  createdAt: string;
  dispatchedAt: string | null;
  payload: Record<string, unknown>;
  recentLogs: Array<{
    channel: string;
    result: string;
    httpStatus: number | null;
    detail: string | null;
    attempt: number;
    createdAt: string;
  }>;
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Menunggu kirim',
  FAILED: 'Gagal, menunggu percobaan ulang',
  DEAD: 'Dead-letter queue',
  SENT: 'Terkirim',
};

export default function AdminNotificationsPage() {
  const [status, setStatus] = useState('DEAD');
  const stats = useApiQuery<Stats>('/admin/notifications/stats');
  const events = useApiQuery<OutboxEvent[]>(
    `/admin/notifications/events?status=${status}&limit=50`,
    [status],
  );
  const { run, pending, error, clearError } = useAction();

  const retry = async (eventId: string) => {
    const result = await run(() => api.post(`/admin/notifications/events/${eventId}/retry`));
    if (result !== null) {
      events.reload();
      stats.reload();
    }
  };

  return (
    <>
      <PageHeader
        title="Monitoring notifikasi"
        description="Antrean outbox, dead-letter queue, dan percobaan ulang manual."
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

      {stats.loading && <LoadingBlock />}

      {stats.data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Menunggu kirim" value={stats.data.pending} />
            <StatTile label="Gagal, akan dicoba lagi" value={stats.data.failed} />
            <StatTile
              label="Dead-letter queue"
              value={stats.data.dead}
              emphasis={stats.data.dead > 0}
              hint={
                stats.data.dead > 0
                  ? `Gagal setelah ${stats.data.maxAttempts} percobaan; perlu tindakan manual.`
                  : 'Tidak ada yang tertahan.'
              }
            />
            <StatTile
              label="Backlog tertua"
              value={`${Math.round(stats.data.oldestBacklogSeconds / 60)}`}
              unit="menit"
              hint="Ambang alert: lebih dari 5 menit."
            />
          </div>

          {stats.data.alerting && (
            <div className="mt-4">
              <Alert tone="danger" title="Ambang alert terlampaui">
                <p>
                  Notifikasi tidak mengalir normal. Periksa layanan automation (n8n) dan jaringan
                  antara worker dan zona Automation.
                </p>
              </Alert>
            </div>
          )}
        </>
      )}

      <div className="mt-6">
        <Card
          title="Daftar event"
          actions={
            <div className="w-56">
              <Select value={status} onChange={(event) => setStatus(event.target.value)}>
                {Object.entries(STATUS_LABEL).map(([code, label]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
          }
        >
          {events.loading && <LoadingBlock />}
          {events.error && <ErrorBlock message={events.error} onRetry={events.reload} />}
          {events.data && events.data.length === 0 && (
            <EmptyState title="Tidak ada event pada status ini" />
          )}

          {events.data && events.data.length > 0 && (
            <ul className="divide-y divide-hairline">
              {events.data.map((event) => (
                <li key={event.id} className="py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {event.eventType}
                        <span className="ml-2 font-mono text-xs text-ink-muted">
                          {String(event.payload.report_code ?? '')}
                        </span>
                      </p>
                      <p className="mt-0.5 text-xs text-ink-muted">
                        Dibuat {formatDateTime(event.createdAt)} · percobaan {event.attempts}
                        {event.status === 'FAILED' &&
                          ` · dicoba lagi ${formatDateTime(event.nextAttemptAt)}`}
                        {event.dispatchedAt && ` · terkirim ${formatDateTime(event.dispatchedAt)}`}
                      </p>
                      {event.lastError && (
                        <p className="mt-1 text-sm text-red-900">{event.lastError}</p>
                      )}

                      {event.recentLogs.length > 0 && (
                        <ul className="mt-2 space-y-1 text-xs text-ink-muted">
                          {event.recentLogs.map((log, index) => (
                            <li key={index}>
                              {log.channel} · percobaan {log.attempt} ·{' '}
                              {log.result === 'SUCCESS' ? '✓ berhasil' : '✕ gagal'}
                              {log.httpStatus ? ` (HTTP ${log.httpStatus})` : ''}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {event.status === 'DEAD' && (
                      <Button variant="primary" loading={pending} onClick={() => retry(event.id)}>
                        Coba ulang
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-4 text-xs text-ink-muted">
            Payload notifikasi sengaja minimal: hanya kode report, status, dan tautan yang tetap
            menuntut login. Tidak ada URL target, isi evidence, nama, atau email di dalamnya.
          </p>
        </Card>
      </div>
    </>
  );
}
