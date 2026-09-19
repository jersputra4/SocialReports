import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '../../components/Layout';
import { PaymentStatusBadge } from '../../components/StatusBadge';
import { Alert, Button, Card, ErrorBlock, Field, Input, LoadingBlock, Select } from '../../components/ui';
import { useAction, useApiQuery } from '../../hooks/useApi';
import { api } from '../../lib/api';
import { formatCountdown, formatDateTime, formatRupiah } from '../../lib/format';

interface MockOrder {
  gatewayOrderId: string;
  reportCode: string;
  amount: string;
  paidAmount: string;
  status: string;
  expired: boolean;
  expiresAt: string;
  paymentMethod: string | null;
}

const METHODS = [
  ['VA_MANDIRI', 'Virtual Account Mandiri'],
  ['VA_BRI', 'Virtual Account BRI'],
  ['VA_BNI', 'Virtual Account BNI'],
  ['GOPAY', 'GoPay'],
  ['DANA', 'DANA'],
  ['SHOPEEPAY', 'ShopeePay'],
];

/**
 * Halaman pembayaran.
 *
 * Pada konfigurasi pengembangan (PAYMENT_DRIVER=mock) halaman ini berperan
 * sebagai halaman checkout penyedia. Yang terjadi setelah tombol ditekan sama
 * persis dengan gateway sungguhan: penyedia mengirim webhook bertanda tangan
 * ke backend, backend mengonfirmasi ulang status lewat panggilan
 * server-to-server, baru status report berubah. Halaman ini sendiri TIDAK
 * pernah mengubah status report.
 */
export default function PaymentPage() {
  const { gatewayOrderId = '' } = useParams();
  const navigate = useNavigate();
  const { run, pending, error, clearError } = useAction();

  const order = useApiQuery<MockOrder>(`/mock-gateway/orders/${gatewayOrderId}`, [gatewayOrderId]);
  const [method, setMethod] = useState('VA_MANDIRI');
  const [amount, setAmount] = useState('');
  const [paid, setPaid] = useState(false);

  useEffect(() => {
    if (order.data && amount === '') {
      const outstanding = BigInt(order.data.amount) - BigInt(order.data.paidAmount);
      setAmount(outstanding > 0n ? outstanding.toString() : order.data.amount);
    }
  }, [order.data, amount]);

  // Setelah pembayaran dikirim, status report berubah lewat webhook. Halaman
  // memuat ulang beberapa kali agar perubahan itu terlihat tanpa refresh manual.
  const reloadOrder = order.reload;
  useEffect(() => {
    if (!paid) return undefined;
    const timer = setInterval(() => reloadOrder(), 2000);
    const stop = setTimeout(() => clearInterval(timer), 12_000);
    return () => {
      clearInterval(timer);
      clearTimeout(stop);
    };
  }, [paid, reloadOrder]);

  if (order.loading) return <LoadingBlock label="Memuat tagihan…" />;
  if (order.error) return <ErrorBlock message={order.error} onRetry={order.reload} />;
  if (!order.data) return null;

  const data = order.data;
  const outstanding = BigInt(data.amount) - BigInt(data.paidAmount);

  const pay = async () => {
    clearError();
    const result = await run(() =>
      api.post<{ webhookDelivered: boolean }>(`/mock-gateway/orders/${gatewayOrderId}/pay`, {
        amount: Number.parseInt(amount, 10),
        paymentMethod: method,
      }),
    );
    if (result) {
      setPaid(true);
      order.reload();
    }
  };

  return (
    <>
      <PageHeader
        title="Pembayaran"
        description={`Tagihan untuk report ${data.reportCode}`}
        actions={
          <Link to={`/report/${data.reportCode}`} className="btn-ghost">
            Ke detail report
          </Link>
        }
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

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card title="Simulasi halaman penyedia pembayaran">
          <Alert tone="info" title="Ini gateway simulasi">
            <p>
              Pada pemasangan sungguhan, halaman ini digantikan halaman milik penyedia
              berlisensi. Mekanismenya tidak berubah: penyedia mengirim webhook bertanda tangan,
              backend mengonfirmasi ulang ke penyedia, lalu status report diperbarui.
            </p>
          </Alert>

          {data.expired ? (
            <div className="mt-4">
              <Alert tone="danger" title="Tagihan kedaluwarsa">
                <p>
                  Tagihan ini sudah melewati batas waktu. Buka detail report untuk membuat tagihan
                  baru — harga akan dihitung ulang dengan tarif yang berlaku saat itu.
                </p>
              </Alert>
            </div>
          ) : data.status === 'PAID' ? (
            <div className="mt-4">
              <Alert tone="success" title="Pembayaran sudah diterima">
                <p>
                  Status report akan berubah otomatis setelah backend selesai memverifikasi.
                </p>
                <p className="mt-2">
                  <button
                    type="button"
                    className="font-medium underline"
                    onClick={() => navigate(`/report/${data.reportCode}`)}
                  >
                    Buka detail report
                  </button>
                </p>
              </Alert>
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              <Field label="Metode pembayaran">
                <Select value={method} onChange={(event) => setMethod(event.target.value)}>
                  {METHODS.map(([code, label]) => (
                    <option key={code} value={code}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                label="Jumlah yang dibayar (rupiah)"
                hint="Ubah nilainya untuk mencoba kasus kurang bayar atau lebih bayar."
              >
                <Input
                  value={amount}
                  onChange={(event) => setAmount(event.target.value.replace(/\D/g, ''))}
                  inputMode="numeric"
                />
              </Field>

              <div className="flex flex-wrap gap-2">
                <Button variant="primary" loading={pending} onClick={pay}>
                  Bayar {formatRupiah(amount)}
                </Button>
                <Button
                  onClick={() => setAmount((BigInt(data.amount) / 2n).toString())}
                  disabled={pending}
                >
                  Isi setengah (uji kurang bayar)
                </Button>
                <Button
                  onClick={() => setAmount((BigInt(data.amount) + 50_000n).toString())}
                  disabled={pending}
                >
                  Lebihkan 50 ribu (uji lebih bayar)
                </Button>
              </div>
            </div>
          )}

          {paid && (
            <div className="mt-4">
              <Alert tone="success">
                <p>
                  Webhook sudah dikirim ke backend. Status di panel sebelah akan menyesuaikan
                  dalam beberapa detik.
                </p>
              </Alert>
            </div>
          )}
        </Card>

        <Card title="Ringkasan tagihan">
          <dl className="divide-y divide-hairline text-sm">
            <div className="flex justify-between gap-3 py-2">
              <dt className="text-ink-secondary">Kode order</dt>
              <dd className="font-mono text-xs">{data.gatewayOrderId}</dd>
            </div>
            <div className="flex justify-between gap-3 py-2">
              <dt className="text-ink-secondary">Status</dt>
              <dd>
                <PaymentStatusBadge status={data.status === 'PAID' ? 'SETTLED' : data.status} />
              </dd>
            </div>
            <div className="flex justify-between gap-3 py-2">
              <dt className="text-ink-secondary">Total tagihan</dt>
              <dd className="numeric font-semibold">{formatRupiah(data.amount)}</dd>
            </div>
            <div className="flex justify-between gap-3 py-2">
              <dt className="text-ink-secondary">Sudah dibayar</dt>
              <dd className="numeric">{formatRupiah(data.paidAmount)}</dd>
            </div>
            <div className="flex justify-between gap-3 py-2">
              <dt className="text-ink-secondary">Sisa</dt>
              <dd className="numeric">{formatRupiah(outstanding.toString())}</dd>
            </div>
            <div className="flex justify-between gap-3 py-2">
              <dt className="text-ink-secondary">Batas waktu</dt>
              <dd className="text-right">
                {formatCountdown(data.expiresAt)}
                <span className="block text-xs text-ink-muted">
                  {formatDateTime(data.expiresAt)}
                </span>
              </dd>
            </div>
          </dl>

          <p className="mt-4 text-xs text-ink-muted">
            Pembayaran yang sudah diterima tidak dapat dikembalikan. Kelebihan bayar dicatat
            tetapi tidak dikembalikan.
          </p>
        </Card>
      </div>
    </>
  );
}
