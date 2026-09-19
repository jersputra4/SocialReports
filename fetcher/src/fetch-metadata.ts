import { lookup as dnsLookup } from 'node:dns';
import * as http from 'node:http';
import * as https from 'node:https';
import {
  FETCH_LIMITS,
  isAllowedContentType,
  isBlockedAddress,
  validateUrlShape,
} from './ssrf-guard';

export interface FetchOutcome {
  status: 'OK' | 'PARTIAL' | 'FAILED';
  canonicalUrl?: string;
  httpStatus?: number;
  metadata?: Record<string, string>;
  redirects?: string[];
  error?: string;
}

/**
 * Resolusi DNS dengan penyaringan alamat.
 *
 * Fungsi ini dipasang sebagai opsi `lookup` pada permintaan HTTP, sehingga
 * koneksi benar-benar dibuat ke alamat yang sudah lolos pemeriksaan. Itulah
 * yang mematikan serangan DNS rebinding: penyerang tidak punya kesempatan
 * mengubah jawaban DNS di antara pemeriksaan dan koneksi, karena keduanya
 * memakai hasil resolusi yang sama (BRD 4.2 poin 3-4).
 */
const pinnedLookup = ((
  hostname: string,
  options: unknown,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | Array<{ address: string; family: number }>,
    family?: number,
  ) => void,
) => {
  dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) return callback(error, '', 4);

    const safe = addresses.filter(
      (entry) => !isBlockedAddress(entry.address, entry.family === 6 ? 6 : 4),
    );

    if (safe.length === 0) {
      const blocked: NodeJS.ErrnoException = new Error(
        `Seluruh alamat IP untuk ${hostname} berada pada rentang yang diblokir`,
      );
      blocked.code = 'EBLOCKEDADDRESS';
      return callback(blocked, '', 4);
    }

    const wantsAll = typeof options === 'object' && options !== null && (options as { all?: boolean }).all;
    if (wantsAll) {
      return callback(null, safe.map((entry) => ({ address: entry.address, family: entry.family })));
    }
    return callback(null, safe[0].address, safe[0].family);
  });
}) as unknown as http.RequestOptions['lookup'];

interface RawResponse {
  httpStatus: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function requestOnce(url: URL): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;

    const request = client.request(
      url,
      {
        method: 'GET',
        lookup: pinnedLookup,
        timeout: FETCH_LIMITS.timeoutMs,
        // Tanpa cookie dan tanpa kredensial apa pun (BRD 4.2 poin 7).
        headers: {
          'User-Agent': FETCH_LIMITS.userAgent,
          Accept: 'text/html,application/json;q=0.9,*/*;q=0.1',
          'Accept-Language': 'id,en;q=0.8',
        },
      },
      (response) => {
        const contentType = response.headers['content-type'];
        const isRedirect =
          response.statusCode !== undefined &&
          response.statusCode >= 300 &&
          response.statusCode < 400;

        if (!isRedirect && !isAllowedContentType(contentType)) {
          response.destroy();
          reject(new Error(`Content-Type ${contentType ?? 'tidak diketahui'} tidak diizinkan`));
          return;
        }

        const declaredLength = Number.parseInt(response.headers['content-length'] ?? '', 10);
        if (Number.isFinite(declaredLength) && declaredLength > FETCH_LIMITS.maxBytes) {
          response.destroy();
          reject(new Error('Ukuran respons melebihi 1 MB'));
          return;
        }

        const chunks: Buffer[] = [];
        let received = 0;

        response.on('data', (chunk: Buffer) => {
          received += chunk.length;
          if (received > FETCH_LIMITS.maxBytes) {
            response.destroy();
            reject(new Error('Ukuran respons melebihi 1 MB'));
            return;
          }
          chunks.push(chunk);
        });

        response.on('end', () => {
          resolve({
            httpStatus: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });

        response.on('error', reject);
      },
    );

    request.on('timeout', () => {
      request.destroy(new Error('Permintaan melebihi batas waktu 5 detik'));
    });
    request.on('error', reject);
    request.end();
  });
}

/**
 * Mengambil metadata satu URL target.
 * Redirect diikuti maksimal 3 kali, dan SETIAP tujuan redirect divalidasi ulang
 * dengan aturan yang sama (BRD 4.2 poin 5, AC-10).
 */
export async function fetchMetadata(
  rawUrl: string,
  allowedDomains: readonly string[],
): Promise<FetchOutcome> {
  const initial = validateUrlShape(rawUrl, allowedDomains);
  if (!initial.ok || !initial.url) {
    return { status: 'FAILED', error: initial.reason ?? 'URL tidak valid' };
  }

  let current = initial.url;
  const redirects: string[] = [];

  for (let hop = 0; hop <= FETCH_LIMITS.maxRedirects; hop += 1) {
    let response: RawResponse;
    try {
      response = await requestOnce(current);
    } catch (error) {
      return { status: 'FAILED', error: (error as Error).message, redirects };
    }

    if (response.httpStatus >= 300 && response.httpStatus < 400 && response.headers.location) {
      if (hop === FETCH_LIMITS.maxRedirects) {
        return { status: 'FAILED', error: 'Terlalu banyak redirect (maksimal 3)', redirects };
      }

      const next = new URL(response.headers.location, current).toString();
      const check = validateUrlShape(next, allowedDomains);
      if (!check.ok || !check.url) {
        return {
          status: 'FAILED',
          error: `Redirect ditolak: ${check.reason ?? 'tujuan tidak valid'}`,
          redirects,
        };
      }
      redirects.push(next);
      current = check.url;
      continue;
    }

    if (response.httpStatus >= 400) {
      return {
        status: 'PARTIAL',
        httpStatus: response.httpStatus,
        canonicalUrl: current.toString(),
        redirects,
        error: `Platform menjawab ${response.httpStatus}`,
      };
    }

    const metadata = extractMetadata(response.body);
    return {
      status: Object.keys(metadata).length > 0 ? 'OK' : 'PARTIAL',
      httpStatus: response.httpStatus,
      canonicalUrl: metadata.canonical ?? current.toString(),
      metadata,
      redirects,
    };
  }

  return { status: 'FAILED', error: 'Terlalu banyak redirect (maksimal 3)', redirects };
}

/**
 * Mengambil metadata Open Graph dan judul halaman.
 *
 * Isi halaman TIDAK dieksekusi dan tidak dirender; hanya dibaca sebagai teks.
 * Nilai yang diambil dibatasi panjangnya dan di-escape saat ditampilkan.
 */
export function extractMetadata(html: string): Record<string, string> {
  const result: Record<string, string> = {};
  const limited = html.slice(0, 200_000);

  const metaPattern =
    /<meta\s+[^>]*?(?:property|name)\s*=\s*["']([^"']+)["'][^>]*?content\s*=\s*["']([^"']*)["'][^>]*>/gi;

  const wanted = new Map<string, string>([
    ['og:title', 'title'],
    ['og:description', 'description'],
    ['og:image', 'image'],
    ['og:site_name', 'siteName'],
    ['og:url', 'url'],
    ['twitter:title', 'title'],
    ['twitter:description', 'description'],
    ['description', 'description'],
  ]);

  let match: RegExpExecArray | null;
  while ((match = metaPattern.exec(limited)) !== null) {
    const key = wanted.get(match[1].toLowerCase());
    if (key && !result[key]) {
      result[key] = decodeEntities(match[2]).slice(0, 500);
    }
  }

  if (!result.title) {
    const title = limited.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i);
    if (title) result.title = decodeEntities(title[1].trim()).slice(0, 300);
  }

  const canonical = limited.match(
    /<link\s+[^>]*rel\s*=\s*["']canonical["'][^>]*href\s*=\s*["']([^"']+)["']/i,
  );
  if (canonical) result.canonical = canonical[1].slice(0, 2000);

  return result;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ');
}
