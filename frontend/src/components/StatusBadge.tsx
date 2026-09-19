import { StatusPresentation, StatusTone, presentStatus, PAYMENT_STATUS } from '../lib/status';

/**
 * Lencana status.
 *
 * Warna status `warning` dan `serious` berada di bawah rasio kontras 3:1 pada
 * permukaan terang. Karena itu lencana selalu membawa GLYPH dan TEKS; warna
 * hanya memperkuat, tidak pernah menjadi satu-satunya pembawa makna.
 */

const TONE_CLASS: Record<StatusTone, { chip: string; dot: string }> = {
  neutral: { chip: 'border-baseline bg-plane text-ink-secondary', dot: 'text-ink-muted' },
  good: { chip: 'border-green-200 bg-green-50 text-success', dot: 'text-status-good' },
  warning: { chip: 'border-amber-200 bg-amber-50 text-amber-900', dot: 'text-status-warning' },
  serious: { chip: 'border-orange-200 bg-orange-50 text-orange-900', dot: 'text-status-serious' },
  critical: { chip: 'border-red-200 bg-red-50 text-red-900', dot: 'text-status-critical' },
};

export function StatusBadge({
  status,
  presentation,
  size = 'md',
}: {
  status: string;
  presentation?: StatusPresentation;
  size?: 'sm' | 'md';
}) {
  const view = presentation ?? presentStatus(status);
  const tone = TONE_CLASS[view.tone];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border ${tone.chip} ${
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs'
      } font-semibold whitespace-nowrap`}
      title={view.description}
    >
      <span aria-hidden className={tone.dot}>
        {view.glyph}
      </span>
      {view.label}
    </span>
  );
}

export function PaymentStatusBadge({ status }: { status: string }) {
  return <StatusBadge status={status} presentation={PAYMENT_STATUS[status]} />;
}
