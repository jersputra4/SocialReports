/**
 * Perlindungan SSRF — BRD/SRS v1.1 §4.2, AC-09, AC-10.
 *
 * Berkas ini hanya berisi fungsi murni sehingga seluruh aturannya dapat diuji
 * tanpa jaringan. Pemakaiannya ada di `fetch-metadata.ts`.
 *
 * Urutan pertahanan:
 *   1. bentuk URL         — skema, port, tanpa userinfo
 *   2. allowlist domain   — hanya host platform yang didukung
 *   3. resolusi DNS sendiri + penyaringan alamat IP
 *   4. koneksi ke IP hasil resolusi (pinning) agar DNS rebinding tidak berguna
 *   5. batas redirect, timeout, ukuran, dan content-type
 */

export interface UrlValidationResult {
  ok: boolean;
  reason?: string;
  url?: URL;
  host?: string;
}

/** Skema dan port yang diizinkan. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const ALLOWED_PORTS = new Set(['', '80', '443']);

export function validateUrlShape(raw: string, allowedDomains: readonly string[]): UrlValidationResult {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'URL tidak dapat dibaca' };
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return { ok: false, reason: `Skema ${url.protocol} tidak diizinkan` };
  }
  if (url.username || url.password) {
    return { ok: false, reason: 'URL tidak boleh memuat kredensial' };
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    return { ok: false, reason: `Port ${url.port} tidak diizinkan` };
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host.length === 0 || host.length > 253) {
    return { ok: false, reason: 'Host tidak valid' };
  }
  // Alamat IP literal tidak pernah diizinkan: allowlist berbasis nama domain.
  if (isIpLiteral(host)) {
    return { ok: false, reason: 'Alamat IP langsung tidak diizinkan' };
  }
  if (!isDomainAllowed(host, allowedDomains)) {
    return { ok: false, reason: `Domain ${host} tidak ada pada daftar platform yang didukung` };
  }

  return { ok: true, url, host };
}

export function isIpLiteral(host: string): boolean {
  if (host.startsWith('[') && host.endsWith(']')) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  // Bentuk numerik lain yang diterima beberapa resolver: 0x7f.1, 2130706433
  if (/^[0-9]+$/.test(host)) return true;
  if (/^0[xX][0-9a-fA-F]+$/.test(host)) return true;
  if (host.includes(':')) return true;
  return false;
}

/** Host cocok bila sama persis dengan domain atau merupakan sub-domainnya. */
export function isDomainAllowed(host: string, allowedDomains: readonly string[]): boolean {
  const normalized = host.toLowerCase();
  return allowedDomains.some((domain) => {
    const d = domain.toLowerCase();
    return normalized === d || normalized.endsWith(`.${d}`);
  });
}

// --------------------------------------------------------------- alamat IP ---

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number.parseInt(part, 10);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

function inRange(value: number, cidr: [string, number]): boolean {
  const base = ipv4ToInt(cidr[0]);
  if (base === null) return false;
  const mask = cidr[1] === 0 ? 0 : (-1 << (32 - cidr[1])) >>> 0;
  return (value & mask) >>> 0 === (base & mask) >>> 0;
}

/**
 * Rentang IPv4 yang selalu ditolak.
 * 169.254.0.0/16 memuat 169.254.169.254 — endpoint metadata pada hampir semua
 * penyedia cloud, dan merupakan sasaran utama SSRF.
 */
const BLOCKED_V4: Array<[string, number]> = [
  ['0.0.0.0', 8],        // "this network"
  ['10.0.0.0', 8],       // privat RFC1918
  ['100.64.0.0', 10],    // CGNAT
  ['127.0.0.0', 8],      // loopback
  ['169.254.0.0', 16],   // link-local termasuk metadata cloud
  ['172.16.0.0', 12],    // privat RFC1918
  ['192.0.0.0', 24],     // IETF protocol assignments
  ['192.0.2.0', 24],     // dokumentasi
  ['192.88.99.0', 24],   // 6to4 relay anycast
  ['192.168.0.0', 16],   // privat RFC1918
  ['198.18.0.0', 15],    // benchmarking
  ['198.51.100.0', 24],  // dokumentasi
  ['203.0.113.0', 24],   // dokumentasi
  ['224.0.0.0', 4],      // multicast
  ['240.0.0.0', 4],      // reserved termasuk 255.255.255.255
];

export function isBlockedIpv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  if (value === null) return true; // bentuk tidak dikenal: tolak
  return BLOCKED_V4.some((cidr) => inRange(value, cidr));
}

export function isBlockedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];

  if (normalized === '::' || normalized === '::1') return true;       // unspecified, loopback
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9')) return true;  // link-local
  if (normalized.startsWith('fea') || normalized.startsWith('feb')) return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;    // ULA
  if (normalized.startsWith('ff')) return true;                        // multicast

  // IPv4-mapped (::ffff:127.0.0.1) dan IPv4-compatible dinilai sebagai IPv4.
  const mapped = normalized.match(/^::(?:ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return isBlockedIpv4(mapped[1]);

  // 64:ff9b::/96 (NAT64) dapat memetakan alamat privat.
  if (normalized.startsWith('64:ff9b:')) return true;

  return false;
}

export function isBlockedAddress(ip: string, family: 4 | 6): boolean {
  return family === 4 ? isBlockedIpv4(ip) : isBlockedIpv6(ip);
}

// ------------------------------------------------------------- content type --

const ALLOWED_CONTENT_TYPES = [
  'text/html',
  'text/plain',
  'application/json',
  'application/ld+json',
  'application/xml',
  'text/xml',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
];

export function isAllowedContentType(contentType: string | undefined): boolean {
  if (!contentType) return false;
  const base = contentType.split(';')[0].trim().toLowerCase();
  return ALLOWED_CONTENT_TYPES.includes(base);
}

export const FETCH_LIMITS = {
  /** BRD 4.2 poin 5 */
  maxRedirects: 3,
  /** BRD 4.2 poin 6 */
  timeoutMs: 5_000,
  maxBytes: 1_048_576,
  userAgent: 'SistemPelaporanKonten/1.1 (+metadata-fetcher; tanpa kredensial)',
} as const;
