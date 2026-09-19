import * as http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { fetchMetadata } from './fetch-metadata';

/**
 * Metadata Fetcher — zona "restricted egress" (BRD/SRS v1.1 §3.2).
 *
 * Satu-satunya komponen yang membuka koneksi ke URL yang diberikan pengguna.
 * Dijalankan sebagai layanan terpisah dengan alasan yang jelas: bila ada
 * kelemahan pada pengambilan metadata, yang terpapar hanyalah proses ini —
 * dan proses ini tidak tersambung ke jaringan zona Data, sehingga tidak dapat
 * menyentuh database maupun object storage.
 *
 * Tidak ada dependensi di luar pustaka bawaan Node.
 */

const PORT = Number.parseInt(process.env.PORT ?? '4001', 10);
const SERVICE_TOKEN = process.env.FETCHER_SERVICE_TOKEN ?? '';
const MAX_BODY_BYTES = 8 * 1024;

if (SERVICE_TOKEN.length < 16) {
  // eslint-disable-next-line no-console
  console.error('FETCHER_SERVICE_TOKEN wajib diisi minimal 16 karakter.');
  process.exit(1);
}

function tokenMatches(provided: string | undefined): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(SERVICE_TOKEN);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function send(response: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'X-Content-Type-Options': 'nosniff',
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

const server = http.createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    send(response, 200, { status: 'ok', service: 'metadata-fetcher' });
    return;
  }

  if (request.method !== 'POST' || request.url !== '/fetch') {
    send(response, 404, { error: 'NotFound' });
    return;
  }

  // Hanya backend yang boleh memanggil; token dibawa antar-layanan.
  if (!tokenMatches(request.headers['x-service-token'] as string | undefined)) {
    send(response, 401, { error: 'Unauthorized' });
    return;
  }

  let parsed: { url?: string; allowedDomains?: string[] };
  try {
    parsed = JSON.parse(await readBody(request));
  } catch {
    send(response, 400, { error: 'BadRequest', message: 'Body bukan JSON yang valid' });
    return;
  }

  if (typeof parsed.url !== 'string' || !Array.isArray(parsed.allowedDomains)) {
    send(response, 400, {
      error: 'BadRequest',
      message: 'Field `url` dan `allowedDomains` wajib diisi',
    });
    return;
  }

  const started = Date.now();
  const outcome = await fetchMetadata(parsed.url, parsed.allowedDomains);

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      event: 'fetch',
      status: outcome.status,
      httpStatus: outcome.httpStatus,
      redirects: outcome.redirects?.length ?? 0,
      durationMs: Date.now() - started,
      error: outcome.error,
    }),
  );

  send(response, 200, outcome);
});

server.headersTimeout = 10_000;
server.requestTimeout = 15_000;

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Metadata Fetcher siap pada port ${PORT}`);
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
