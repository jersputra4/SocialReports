import { FormEvent, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AuthShell } from '../../components/AuthShell';
import { Alert, Button, Field, Input } from '../../components/ui';
import { ApiError, api } from '../../lib/api';

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<string[] | null>(null);
  const [done, setDone] = useState(false);

  const mismatch = confirmation.length > 0 && password !== confirmation;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (mismatch) return;

    setSubmitting(true);
    setErrors(null);

    try {
      await api.post('/auth/password-reset/confirm', { token, newPassword: password });
      setDone(true);
    } catch (caught) {
      setErrors(caught instanceof ApiError ? caught.messages : ['Gagal mengubah kata sandi.']);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Atur ulang kata sandi"
      footer={
        <Link to="/masuk" className="font-medium text-accent-700 underline">
          Ke halaman masuk
        </Link>
      }
    >
      {done ? (
        <Alert tone="success" title="Kata sandi berhasil diubah">
          <p>Silakan masuk kembali dengan kata sandi baru Anda.</p>
        </Alert>
      ) : !token ? (
        <Alert tone="danger" title="Tautan tidak lengkap">
          <p>Buka halaman ini lewat tautan yang dikirim ke email Anda.</p>
        </Alert>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {errors && (
            <Alert tone="danger" title="Kata sandi belum dapat dipakai">
              {errors.map((message) => (
                <p key={message}>{message}</p>
              ))}
            </Alert>
          )}

          <Field
            label="Kata sandi baru"
            required
            hint="Minimal 10 karakter, dan tidak boleh kata sandi yang umum dipakai."
          >
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              minLength={10}
              required
            />
          </Field>

          <Field
            label="Ulangi kata sandi baru"
            required
            error={mismatch ? 'Kedua kata sandi belum sama.' : undefined}
          >
            <Input
              type="password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="new-password"
              invalid={mismatch}
              required
            />
          </Field>

          <Button
            type="submit"
            variant="primary"
            loading={submitting}
            disabled={mismatch || password.length < 10}
            className="w-full"
          >
            Simpan kata sandi baru
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
