import { useState } from 'react';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Alert, Button, Field, Input, Modal } from './ui';

/**
 * Dialog step-up MFA.
 *
 * Muncul ketika backend menjawab 428 pada tindakan sensitif: ubah harga/PPN,
 * ubah master hukum/kebijakan, atau void bukti pengerjaan. Pengguna memasukkan
 * OTP baru, lalu tindakan yang tadi tertahan dijalankan ulang.
 */
export function StepUpDialog({
  open,
  onClose,
  onVerified,
  actionLabel,
}: {
  open: boolean;
  onClose: () => void;
  onVerified: () => void;
  actionLabel: string;
}) {
  const { refresh } = useAuth();
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const requestCode = async () => {
    setSending(true);
    setError(null);
    try {
      const result = await api.post<{ challengeId: string }>('/auth/mfa/step-up/request');
      setChallengeId(result.challengeId);
      setSent(true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Gagal mengirim kode.');
    } finally {
      setSending(false);
    }
  };

  const verify = async () => {
    if (!challengeId) return;
    setVerifying(true);
    setError(null);
    try {
      await api.post('/auth/mfa/step-up/verify', { challengeId, otp });
      await refresh();
      setOtp('');
      setSent(false);
      setChallengeId(null);
      onVerified();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Kode tidak valid.');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Konfirmasi tindakan sensitif"
      description={`${actionLabel} memerlukan verifikasi ulang dengan kode dari email Anda.`}
      footer={
        <>
          <Button onClick={onClose}>Batal</Button>
          {!sent ? (
            <Button variant="primary" loading={sending} onClick={requestCode}>
              Kirim kode ke email
            </Button>
          ) : (
            <Button variant="primary" loading={verifying} disabled={otp.length !== 6} onClick={verify}>
              Konfirmasi
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}

        {!sent ? (
          <p className="text-sm text-ink-secondary">
            Untuk alasan keamanan, tindakan ini meminta kode sekali pakai walaupun Anda sudah
            masuk. Kode berlaku 5 menit dan hanya berguna pada peramban ini.
          </p>
        ) : (
          <>
            <Alert tone="success">Kode sudah dikirim ke alamat email Anda.</Alert>
            <Field label="Kode 6 angka" required>
              <Input
                value={otp}
                onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                className="text-center text-2xl tracking-[0.4em]"
              />
            </Field>
          </>
        )}
      </div>
    </Modal>
  );
}

/**
 * Menyederhanakan pemakaian: bungkus pemanggilan API yang bisa membalas 428.
 * Bila step-up dibutuhkan, dialog dibuka dan aksi dijalankan ulang setelah
 * verifikasi berhasil.
 */
export function useStepUp() {
  const [pendingAction, setPendingAction] = useState<null | (() => Promise<void>)>(null);
  const [label, setLabel] = useState('Tindakan ini');

  const run = async (action: () => Promise<void>, actionLabel: string) => {
    try {
      await action();
    } catch (error) {
      if (error instanceof ApiError && error.needsStepUp) {
        setLabel(actionLabel);
        setPendingAction(() => action);
        return;
      }
      throw error;
    }
  };

  const dialog = (
    <StepUpDialog
      open={pendingAction !== null}
      actionLabel={label}
      onClose={() => setPendingAction(null)}
      onVerified={async () => {
        const action = pendingAction;
        setPendingAction(null);
        if (action) await action();
      }}
    />
  );

  return { run, dialog };
}
