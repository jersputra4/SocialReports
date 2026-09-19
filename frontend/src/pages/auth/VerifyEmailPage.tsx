import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AuthShell } from '../../components/AuthShell';
import { Alert, LoadingBlock } from '../../components/ui';
import { ApiError, api } from '../../lib/api';

type State = 'VERIFYING' | 'SUCCESS' | 'FAILED';

export default function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [state, setState] = useState<State>('VERIFYING');
  const [message, setMessage] = useState('');
  const started = useRef(false);

  useEffect(() => {
    // Token sekali pakai: pastikan hanya satu permintaan walaupun React
    // StrictMode menjalankan efek dua kali saat pengembangan.
    if (started.current) return;
    started.current = true;

    if (!token) {
      setState('FAILED');
      setMessage('Tautan verifikasi tidak lengkap.');
      return;
    }

    api
      .post('/auth/verify-email', { token })
      .then(() => setState('SUCCESS'))
      .catch((error) => {
        setState('FAILED');
        setMessage(
          error instanceof ApiError ? error.message : 'Verifikasi gagal. Coba lagi nanti.',
        );
      });
  }, [token]);

  return (
    <AuthShell
      title="Verifikasi email"
      footer={
        <Link to="/masuk" className="font-medium text-accent-700 underline">
          Ke halaman masuk
        </Link>
      }
    >
      {state === 'VERIFYING' && <LoadingBlock label="Memverifikasi tautan…" />}

      {state === 'SUCCESS' && (
        <Alert tone="success" title="Email terverifikasi">
          <p>Akun Anda sudah aktif. Silakan masuk untuk mulai membuat report.</p>
        </Alert>
      )}

      {state === 'FAILED' && (
        <Alert tone="danger" title="Tautan tidak dapat dipakai">
          <p>{message}</p>
          <p>
            Tautan berlaku 24 jam dan hanya sekali pakai. Coba masuk untuk meminta tautan baru.
          </p>
        </Alert>
      )}
    </AuthShell>
  );
}
