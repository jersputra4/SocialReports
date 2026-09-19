import { useState } from 'react';
import { PageHeader } from '../../components/Layout';
import { useStepUp } from '../../components/StepUpDialog';
import {
  Alert,
  Button,
  Card,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
} from '../../components/ui';
import { useApiQuery } from '../../hooks/useApi';
import { ApiError, api } from '../../lib/api';
import { formatDateTime, formatRupiah, formatTaxRate } from '../../lib/format';

interface PricingHistory {
  pricing: Array<{ id: string; unitPrice: string; effectiveFrom: string; effectiveTo: string | null }>;
  tax: Array<{
    id: string;
    taxName: string;
    rateBp: number;
    effectiveFrom: string;
    effectiveTo: string | null;
  }>;
}

/** Waktu lokal (datetime-local) menjadi ISO, dengan default satu jam ke depan. */
function defaultEffectiveFrom(): string {
  const date = new Date(Date.now() + 3_600_000);
  date.setMinutes(0, 0, 0);
  return date.toISOString().slice(0, 16);
}

export default function AdminPricingPage() {
  const history = useApiQuery<PricingHistory>('/admin/pricing');
  const { run: runStepUp, dialog } = useStepUp();

  const [unitPrice, setUnitPrice] = useState('');
  const [priceFrom, setPriceFrom] = useState(defaultEffectiveFrom);
  const [rateBp, setRateBp] = useState('');
  const [taxFrom, setTaxFrom] = useState(defaultEffectiveFrom);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  const currentPrice = history.data?.pricing.find((row) => row.effectiveTo === null);
  const currentTax = history.data?.tax.find((row) => row.effectiveTo === null);

  const schedulePrice = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await runStepUp(async () => {
        await api.post('/admin/pricing', {
          unitPrice: Number.parseInt(unitPrice, 10),
          effectiveFrom: new Date(priceFrom).toISOString(),
        });
        setMessage('Harga baru dijadwalkan.');
        setUnitPrice('');
        history.reload();
      }, 'Mengubah harga satuan');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.messages : ['Gagal menyimpan harga.']);
    } finally {
      setBusy(false);
    }
  };

  const scheduleTax = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await runStepUp(async () => {
        await api.post('/admin/tax', {
          rateBp: Number.parseInt(rateBp, 10),
          effectiveFrom: new Date(taxFrom).toISOString(),
        });
        setMessage('Tarif PPN baru dijadwalkan.');
        setRateBp('');
        history.reload();
      }, 'Mengubah tarif PPN');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.messages : ['Gagal menyimpan tarif.']);
    } finally {
      setBusy(false);
    }
  };

  if (history.loading) return <LoadingBlock />;
  if (history.error) return <ErrorBlock message={history.error} onRetry={history.reload} />;

  return (
    <>
      <PageHeader
        title="Harga dan PPN"
        description="Nilai yang berlaku diambil berdasarkan tanggal, bukan ditulis di kode."
      />

      <Alert tone="info" title="Perubahan tidak berlaku surut">
        <p>
          Report yang sudah melewati tahap draf memakai salinan harga dan tarif miliknya sendiri.
          Mengubah nilai di sini hanya memengaruhi report dan tagihan baru.
        </p>
      </Alert>

      {message && (
        <div className="mt-4">
          <Alert tone="success" onDismiss={() => setMessage(null)}>
            {message}
          </Alert>
        </div>
      )}
      {error && (
        <div className="mt-4">
          <Alert tone="danger" onDismiss={() => setError(null)}>
            {error.map((item) => (
              <p key={item}>{item}</p>
            ))}
          </Alert>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Harga satuan" description={`Berlaku sekarang: ${formatRupiah(currentPrice?.unitPrice ?? null)} per unit`}>
          <div className="space-y-4">
            <Field label="Harga baru per unit (rupiah)" required>
              <Input
                value={unitPrice}
                onChange={(event) => setUnitPrice(event.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
                placeholder="1000"
              />
            </Field>
            <Field label="Berlaku mulai" required hint="Tidak dapat mundur ke masa lalu.">
              <Input
                type="datetime-local"
                value={priceFrom}
                onChange={(event) => setPriceFrom(event.target.value)}
              />
            </Field>
            <Button variant="primary" loading={busy} disabled={!unitPrice} onClick={schedulePrice}>
              Jadwalkan harga baru
            </Button>
          </div>

          <h3 className="mt-6 text-sm font-semibold">Riwayat</h3>
          <div className="table-wrap mt-2">
            <table className="data-table min-w-0">
              <thead>
                <tr>
                  <th>Harga</th>
                  <th>Mulai</th>
                  <th>Sampai</th>
                </tr>
              </thead>
              <tbody>
                {history.data?.pricing.map((row) => (
                  <tr key={row.id}>
                    <td className="numeric">{formatRupiah(row.unitPrice)}</td>
                    <td className="whitespace-nowrap">{formatDateTime(row.effectiveFrom)}</td>
                    <td className="whitespace-nowrap">
                      {row.effectiveTo ? formatDateTime(row.effectiveTo) : 'Berlaku'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Tarif PPN" description={`Berlaku sekarang: ${formatTaxRate(currentTax?.rateBp ?? null)}`}>
          <div className="space-y-4">
            <Field
              label="Tarif baru (basis poin)"
              required
              hint="1100 berarti 11,00%. Nilai 0 sampai 10000."
            >
              <Input
                value={rateBp}
                onChange={(event) => setRateBp(event.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
                placeholder="1100"
              />
            </Field>
            <Field label="Berlaku mulai" required>
              <Input
                type="datetime-local"
                value={taxFrom}
                onChange={(event) => setTaxFrom(event.target.value)}
              />
            </Field>
            <Button variant="primary" loading={busy} disabled={!rateBp} onClick={scheduleTax}>
              Jadwalkan tarif baru
            </Button>
          </div>

          <h3 className="mt-6 text-sm font-semibold">Riwayat</h3>
          <div className="table-wrap mt-2">
            <table className="data-table min-w-0">
              <thead>
                <tr>
                  <th>Tarif</th>
                  <th>Mulai</th>
                  <th>Sampai</th>
                </tr>
              </thead>
              <tbody>
                {history.data?.tax.map((row) => (
                  <tr key={row.id}>
                    <td className="numeric">{formatTaxRate(row.rateBp)}</td>
                    <td className="whitespace-nowrap">{formatDateTime(row.effectiveFrom)}</td>
                    <td className="whitespace-nowrap">
                      {row.effectiveTo ? formatDateTime(row.effectiveTo) : 'Berlaku'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {dialog}
    </>
  );
}
