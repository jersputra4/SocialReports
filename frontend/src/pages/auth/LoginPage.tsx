import { FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AuthShell } from '../../components/AuthShell';
import { Alert, Button, Field, Input } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { ApiError } from '../../lib/api';

type Stage = 'CREDENTIALS' | 'OTP';

export default function LoginPage() {
  const { login, verifyMfa, resendMfa } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [stage, setStage] = useState<Stage>('CREDENTIALS');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<string | null>(null);

  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/';

  const submitCredentials = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setLockedUntil(null);

    try {
      const result = await login(email, password);
      if (result.kind === 'MFA_REQUIRED') {
        setChallengeId(result.challengeId);
        setStage('OTP');
        setNotice('Kode verifikasi sudah dikirim ke email Anda.');
      } else {
        navigate(redirectTo, { replace: true });
      }
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.messages);
        const details = caught.details as { lockedUntil?: string } | undefined;
        if (caught.status === 423) {
          setLockedUntil(details?.lockedUntil ?? null);
        }
      } else {
        setError(['Tidak dapat terhubung ke server.']);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const submitOtp = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      await verifyMfa(challengeId, otp);
      navigate(redirectTo, { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.messages : ['Kode tidak valid.']);
    } finally {
      setSubmitting(false);
    }
  };

  const resend = async () => {
    setError(null);
    try {
      const result = await resendMfa(challengeId);
      setChallengeId(result.challengeId);
      setNotice('Kode baru sudah dikirim.');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.messages : ['Gagal mengirim ulang kode.']);
    }
  };

  return (
    <AuthShell
      title={stage === 'CREDENTIALS' ? 'Masuk' : 'Masukkan kode verifikasi'}
      description={
        stage === 'CREDENTIALS'
          ? 'Gunakan email dan kata sandi akun Anda.'
          : 'Kami mengirim kode 6 angka ke email terdaftar. Kode berlaku 5 menit.'
      }
      footer={
        stage === 'CREDENTIALS' ? (
          <>
            <p>
              Belum punya akun?{' '}
              <Link to="/daftar" className="font-medium text-accent-700 underline">
                Daftar di sini
              </Link>
            </p>
            <p className="mt-2">
              <Link to="/lupa-kata-sandi" className="font-medium text-accent-700 underline">
                Lupa kata sandi?
              </Link>
            </p>
            <p className="mt-2">
              <Link to="/panduan" className="font-medium text-accent-700 underline">
                Baca panduan pelapor
              </Link>
            </p>
          </>
        ) : null
      }
    >
      {error && (
        <div className="mb-4">
          <Alert tone="danger" title="Tidak dapat masuk">
            {error.map((message) => (
              <p key={message}>{message}</p>
            ))}
            {lockedUntil && (
              <p className="mt-1">
                Coba lagi setelah {new Date(lockedUntil).toLocaleTimeString('id-ID')}.
              </p>
            )}
          </Alert>
        </div>
      )}

      {notice && stage === 'OTP' && (
        <div className="mb-4">
          <Alert tone="success" onDismiss={() => setNotice(null)}>
            {notice}
          </Alert>
        </div>
      )}

      {stage === 'CREDENTIALS' ? (
        <form onSubmit={submitCredentials} className="space-y-4">
          <Field label="Email" required>
            <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
              required
              placeholder="nama@contoh.com"
            />
          </Field>

          <Field label="Kata sandi" required>
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </Field>

          <Button type="submit" variant="primary" loading={submitting} className="w-full">
            Masuk
          </Button>

          <p className="text-xs text-ink-muted">
            Akun internal (admin, reviewer, finance) selalu diminta kode verifikasi tambahan.
          </p>
        </form>
      ) : (
        <form onSubmit={submitOtp} className="space-y-4">
          <Field label="Kode 6 angka" required>
            <Input
              value={otp}
              onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              className="text-center text-2xl tracking-[0.4em]"
              required
            />
          </Field>

          <Button
            type="submit"
            variant="primary"
            loading={submitting}
            disabled={otp.length !== 6}
            className="w-full"
          >
            Verifikasi dan masuk
          </Button>

          <div className="flex items-center justify-between text-sm">
            <button type="button" onClick={resend} className="font-medium text-accent-700 underline">
              Kirim ulang kode
            </button>
            <button
              type="button"
              onClick={() => {
                setStage('CREDENTIALS');
                setOtp('');
              }}
              className="text-ink-secondary underline"
            >
              Ganti akun
            </button>
          </div>

          <p className="text-xs text-ink-muted">
            Kirim ulang dibatasi satu kali per menit dan maksimal tiga kali per sepuluh menit.
          </p>
        </form>
      )}
    </AuthShell>
  );
}
