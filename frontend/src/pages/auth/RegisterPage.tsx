import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthShell } from '../../components/AuthShell';
import { Alert, Button, Field, Input } from '../../components/ui';
import { ApiError, api } from '../../lib/api';

export default function RegisterPage() {
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', password: '' });
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<string[] | null>(null);
  const [done, setDone] = useState(false);

  const update = (field: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setErrors(null);

    try {
      await api.post('/auth/register', {
        fullName: form.fullName,
        email: form.email,
        password: form.password,
        phone: form.phone || undefined,
      });
      setDone(true);
    } catch (caught) {
      setErrors(caught instanceof ApiError ? caught.messages : ['Pendaftaran gagal.']);
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <AuthShell
        title="Periksa email Anda"
        description="Langkah terakhir sebelum akun dapat dipakai."
        footer={
          <Link to="/masuk" className="font-medium text-accent-700 underline">
            Kembali ke halaman masuk
          </Link>
        }
      >
        <Alert tone="success" title="Tautan verifikasi sudah dikirim">
          <p>
            Bila alamat tersebut belum terdaftar, kami mengirim tautan verifikasi ke{' '}
            <strong>{form.email}</strong>. Tautan berlaku 24 jam dan hanya dapat dipakai sekali.
          </p>
          <p>Report baru hanya dapat dibuat setelah email terverifikasi.</p>
        </Alert>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Buat akun"
      description="Akun diperlukan untuk membuat dan memantau report."
      footer={
        <p>
          Sudah punya akun?{' '}
          <Link to="/masuk" className="font-medium text-accent-700 underline">
            Masuk di sini
          </Link>
        </p>
      }
    >
      {errors && (
        <div className="mb-4">
          <Alert tone="danger" title="Pendaftaran belum dapat diproses">
            {errors.map((message) => (
              <p key={message}>{message}</p>
            ))}
          </Alert>
        </div>
      )}

      <form onSubmit={submit} className="space-y-4">
        <Field label="Nama lengkap" required>
          <Input value={form.fullName} onChange={update('fullName')} required maxLength={160} />
        </Field>

        <Field
          label="Email"
          required
          hint="Alamat ini dipakai untuk verifikasi masuk dan tidak dapat diubah sendiri nanti."
        >
          <Input
            type="email"
            value={form.email}
            onChange={update('email')}
            autoComplete="username"
            required
          />
        </Field>

        <Field label="Nomor telepon" hint="Opsional.">
          <Input value={form.phone} onChange={update('phone')} inputMode="tel" />
        </Field>

        <Field
          label="Kata sandi"
          required
          hint="Minimal 10 karakter. Frasa panjang lebih aman daripada kata pendek dengan simbol."
        >
          <Input
            type="password"
            value={form.password}
            onChange={update('password')}
            autoComplete="new-password"
            minLength={10}
            required
          />
        </Field>

        <Button type="submit" variant="primary" loading={submitting} className="w-full">
          Daftar
        </Button>

        <p className="text-xs text-ink-muted">
          Dengan mendaftar, Anda menyatakan sebagai pihak yang berkepentingan terhadap konten yang
          akan dilaporkan.
        </p>
      </form>
    </AuthShell>
  );
}
