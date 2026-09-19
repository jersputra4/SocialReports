import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthShell } from '../../components/AuthShell';
import { Alert, Button, Field, Input } from '../../components/ui';
import { ApiError, api } from '../../lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      await api.post('/auth/password-reset/request', { email });
      setSent(true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Permintaan gagal dikirim.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Lupa kata sandi"
      description="Kami akan mengirim tautan untuk mengatur ulang kata sandi Anda."
      footer={
        <Link to="/masuk" className="font-medium text-accent-700 underline">
          Kembali ke halaman masuk
        </Link>
      }
    >
      {sent ? (
        <Alert tone="success" title="Permintaan diterima">
          <p>
            Bila alamat tersebut terdaftar, tautan untuk mengatur ulang kata sandi sudah kami
            kirim. Tautan berlaku 30 menit.
          </p>
          <p>Seluruh sesi aktif akan dikeluarkan setelah kata sandi diubah.</p>
        </Alert>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}

          <Field label="Email terdaftar" required>
            <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
              required
            />
          </Field>

          <Button type="submit" variant="primary" loading={submitting} className="w-full">
            Kirim tautan
          </Button>

          <p className="text-xs text-ink-muted">
            Demi keamanan, jawabannya sama baik alamat tersebut terdaftar maupun tidak.
          </p>
        </form>
      )}
    </AuthShell>
  );
}
