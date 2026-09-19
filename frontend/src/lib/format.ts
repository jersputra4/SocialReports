/**
 * Format tampilan.
 *
 * Uang datang dari API sebagai STRING (backend memakai BigInt agar tidak ada
 * galat pembulatan). Jangan pernah mengubahnya menjadi Number sebelum
 * diformat — nilai di atas 9.007 kuadriliun akan kehilangan presisi.
 */

export function formatRupiah(amount: string | number | null | undefined): string {
  if (amount === null || amount === undefined || amount === '') return '—';

  const raw = typeof amount === 'number' ? Math.round(amount).toString() : amount;
  const negative = raw.startsWith('-');
  const digits = negative ? raw.slice(1) : raw;

  if (!/^\d+$/.test(digits)) return '—';

  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += '.';
    out += digits[i];
  }
  return `${negative ? '-' : ''}Rp${out}`;
}

export function formatTaxRate(rateBp: number | null | undefined): string {
  if (rateBp === null || rateBp === undefined) return '—';
  return `${(rateBp / 100).toString().replace('.', ',')}%`;
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('id-ID').format(value);
}

/** Nilai besar pada stat tile: 1.284 / 12,9 rb / 4,2 jt */
export function formatCompact(value: number): string {
  if (Math.abs(value) < 10_000) return formatNumber(value);
  if (Math.abs(value) < 1_000_000) {
    return `${(value / 1000).toFixed(1).replace('.', ',')} rb`;
  }
  return `${(value / 1_000_000).toFixed(1).replace('.', ',')} jt`;
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Jakarta',
  }).format(date);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeZone: 'Asia/Jakarta',
  }).format(date);
}

export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  const diffMs = date.getTime() - Date.now();
  const absMinutes = Math.abs(diffMs) / 60_000;

  const formatter = new Intl.RelativeTimeFormat('id-ID', { numeric: 'auto' });

  if (absMinutes < 60) return formatter.format(Math.round(diffMs / 60_000), 'minute');
  if (absMinutes < 1440) return formatter.format(Math.round(diffMs / 3_600_000), 'hour');
  return formatter.format(Math.round(diffMs / 86_400_000), 'day');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

/** Hitung mundur yang mudah dibaca: "23 jam 14 menit lagi" */
export function formatCountdown(target: string | Date | null | undefined): string {
  if (!target) return '—';
  const date = typeof target === 'string' ? new Date(target) : target;
  const remaining = date.getTime() - Date.now();
  if (remaining <= 0) return 'sudah lewat';

  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  if (hours > 0) return `${hours} jam ${minutes} menit lagi`;
  return `${minutes} menit lagi`;
}
