import { ReactNode } from 'react';
import { formatCompact, formatNumber } from '../lib/format';

/**
 * Angka-angka dasbor.
 *
 * Bentuknya dipilih lebih dulu, bukan warnanya:
 *   - sederet angka utama -> baris stat tile, bukan bar chart bertumpuk;
 *   - satu rasio terhadap batas -> meter dengan track satu ramp warna;
 *   - perbandingan besaran antar tahap -> bar sekuensial satu hue.
 *
 * Tidak ada pustaka grafik: seluruhnya HTML/CSS, sehingga ringan, dapat
 * dicetak, dan tetap terbaca ketika warna dimatikan.
 */

export function StatTile({
  label,
  value,
  unit,
  hint,
  emphasis = false,
}: {
  label: string;
  value: number | string;
  unit?: string;
  hint?: ReactNode;
  emphasis?: boolean;
}) {
  const display =
    typeof value === 'number' ? (value >= 10_000 ? formatCompact(value) : formatNumber(value)) : value;

  return (
    <div className="card p-4">
      <p className="text-sm text-ink-secondary">{label}</p>
      <p
        className={`mt-1 font-semibold leading-none ${
          emphasis ? 'text-4xl sm:text-5xl' : 'text-2xl'
        }`}
      >
        {display}
        {unit && <span className="ml-1 text-base font-medium text-ink-secondary">{unit}</span>}
      </p>
      {hint && <p className="mt-2 text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}

/**
 * Meter progres unit.
 * Isi dan track memakai ramp yang sama (biru pekat di atas biru muda) sehingga
 * keadaannya terbaca di sepanjang bar, bukan hanya di ujung isian.
 */
export function ProgressMeter({
  value,
  total,
  label,
  unitLabel = 'unit',
}: {
  value: number;
  total: number;
  label: string;
  unitLabel?: string;
}) {
  const safeTotal = Math.max(1, total);
  const percentage = Math.min(100, Math.round((value / safeTotal) * 100));

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-ink-secondary">{label}</span>
        <span className="text-sm font-semibold numeric">
          {formatNumber(value)} / {formatNumber(total)} {unitLabel}
        </span>
      </div>
      <div
        className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-accent-50"
        role="progressbar"
        aria-valuenow={percentage}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className="h-full rounded-full bg-accent-600 transition-[width] duration-500"
          style={{ width: `${percentage}%` }}
        />
      </div>
      <p className="mt-1 text-xs text-ink-muted">{percentage}% tercakup</p>
    </div>
  );
}

/**
 * Perbandingan besaran antar tahap.
 * Satu hue, lebih besar lebih pekat — bukan warna berbeda per tahap, karena
 * yang dibandingkan adalah besaran, bukan identitas.
 */
export function StageBars({
  items,
  emptyLabel = 'Belum ada report pada tahap mana pun.',
}: {
  items: Array<{ label: string; value: number }>;
  emptyLabel?: string;
}) {
  const max = Math.max(1, ...items.map((item) => item.value));
  const hasData = items.some((item) => item.value > 0);

  if (!hasData) {
    return <p className="py-6 text-center text-sm text-ink-muted">{emptyLabel}</p>;
  }

  return (
    <ul className="space-y-3">
      {items.map((item) => {
        const ratio = item.value / max;
        // Ramp sekuensial: makin besar makin pekat.
        const shade =
          ratio > 0.75 ? 'bg-accent-700' : ratio > 0.5 ? 'bg-accent-600' : ratio > 0.25 ? 'bg-accent-500' : 'bg-accent-300';

        return (
          <li key={item.label} className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-3">
            <span className="truncate text-sm text-ink-secondary">{item.label}</span>
            <span className="h-4 w-full rounded-sm bg-plane">
              <span
                className={`block h-4 rounded-r-[4px] ${shade}`}
                style={{ width: `${Math.max(2, ratio * 100)}%` }}
                aria-hidden
              />
            </span>
            <span className="numeric text-sm font-semibold tabular-nums">
              {formatNumber(item.value)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
