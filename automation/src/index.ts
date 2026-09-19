import * as http from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Simulator n8n — zona Automation (BRD/SRS v1.1 §3.2 dan §4.4).
 *
 * Menggantikan instance n8n saat pengembangan lokal, dengan perilaku yang
 * sama pada hal-hal yang penting:
 *   - menolak permintaan tanpa HMAC-SHA256 yang benar;
 *   - menolak permintaan dengan selisih waktu lebih dari 5 menit;
 *   - melakukan deduplikasi berdasarkan event_id;
 *   - melakukan fan-out ke kanal admin (email, WhatsApp, Telegram).
 *
 * Layanan ini sengaja TIDAK tersambung ke jaringan zona Data: ia tidak punya
 * akses ke database maupun object storage, dan hanya menerima event dari
 * worker. Karena itu payload yang diterimanya minimal — tidak ada URL target,
 * isi evidence, nama, maupun email.
 *
 * Untuk n8n sungguhan, alur yang setara tersedia di n8n/workflows/.
 */

const PORT = Number.parseInt(process.env.PORT ?? '4002', 10);
const SECRET = process.env.N8N_HMAC_SECRET ?? '';
const TOLERANCE_SECONDS = Number.parseInt(process.env.N8N_TIMESTAMP_TOLERANCE_SECONDS ?? '300', 10);
const MAX_BODY_BYTES = 64 * 1024;

if (SECRET.length < 16) {
  // eslint-disable-next-line no-console
  console.error('N8N_HMAC_SECRET wajib diisi minimal 16 karakter.');
  process.exit(1);
}

interface Delivery {
  eventId: string;
  eventType: string;
  reportCode: string | null;
  status: string | null;
  receivedAt: string;
  channels: string[];
}

/** Riwayat singkat untuk pemeriksaan manual. Bukan penyimpanan permanen. */
const deliveries: Delivery[] = [];
const seenEventIds = new Set<string>();

/**
 * Kanal notifikasi admin.
 *
 * Pada n8n sungguhan setiap kanal adalah node tersendiri: SMTP untuk email,
 * WhatsApp Business Platform resmi, dan Telegram Bot API. Library WhatsApp
 * tidak resmi tidak dipakai (BRD 4.4).
 */
const CHANNELS = ['EMAIL_ADMIN', 'WHATSAPP_ADMIN', 'TELEGRAM_ADMIN'];

function send(response: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

function readBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        request.destroy();
        reject(new Error('Body terlalu besar'));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function signatureValid(timestamp: string, body: string, provided: string): boolean {
  const expected = createHmac('sha256', SECRET).update(`${timestamp}.${body}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const server = http.createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    send(response, 200, { status: 'ok', service: 'automation', deliveries: deliveries.length });
    return;
  }

  if (request.method === 'GET' && request.url?.startsWith('/deliveries')) {
    send(response, 200, deliveries.slice(-100).reverse());
    return;
  }

  if (request.method !== 'POST' || request.url !== '/webhook/report-events') {
    send(response, 404, { error: 'NotFound' });
    return;
  }

  let body: string;
  try {
    body = await readBody(request);
  } catch {
    send(response, 413, { error: 'PayloadTooLarge' });
    return;
  }

  const signature = request.headers['x-signature'];
  const timestamp = request.headers['x-timestamp'];

  if (typeof signature !== 'string' || typeof timestamp !== 'string') {
    send(response, 401, { error: 'Unauthorized', reason: 'header tanda tangan tidak lengkap' });
    return;
  }

  const skew = Math.abs(Math.floor(Date.now() / 1000) - Number.parseInt(timestamp, 10));
  if (!Number.isFinite(skew) || skew > TOLERANCE_SECONDS) {
    send(response, 401, { error: 'Unauthorized', reason: `selisih waktu ${skew} detik` });
    return;
  }

  if (!signatureValid(timestamp, body, signature)) {
    send(response, 401, { error: 'Unauthorized', reason: 'tanda tangan tidak cocok' });
    return;
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body) as Record<string, unknown>;
  } catch {
    send(response, 400, { error: 'BadRequest', reason: 'body bukan JSON' });
    return;
  }

  const eventId = typeof payload.event_id === 'string' ? payload.event_id : null;
  if (!eventId) {
    send(response, 400, { error: 'BadRequest', reason: 'event_id tidak ada' });
    return;
  }

  // Deduplikasi: pengiriman ulang event yang sama tidak menghasilkan
  // notifikasi kedua, tetapi tetap dibalas 200 agar pengirim berhenti mencoba.
  if (seenEventIds.has(eventId)) {
    send(response, 200, { received: true, duplicate: true, channels: [] });
    return;
  }
  seenEventIds.add(eventId);

  // Payload sengaja hanya memuat penanda; tidak ada data pribadi di sini.
  const delivery: Delivery = {
    eventId,
    eventType: String(payload.event_type ?? 'UNKNOWN'),
    reportCode: typeof payload.report_code === 'string' ? payload.report_code : null,
    status: typeof payload.status === 'string' ? payload.status : null,
    receivedAt: new Date().toISOString(),
    channels: CHANNELS,
  };

  deliveries.push(delivery);
  if (deliveries.length > 500) deliveries.shift();

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      event: 'fanout',
      eventId: delivery.eventId,
      eventType: delivery.eventType,
      reportCode: delivery.reportCode,
      status: delivery.status,
      channels: delivery.channels,
    }),
  );

  send(response, 200, { received: true, duplicate: false, channels: CHANNELS });
});

server.headersTimeout = 10_000;
server.requestTimeout = 15_000;

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Automation (simulator n8n) siap pada port ${PORT}`);
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
