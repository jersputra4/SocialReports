import { FormEvent, useEffect, useState } from 'react';
import { PageHeader } from '../../components/Layout';
import { Alert, Button, Card, Field, Input, LoadingBlock } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useAction, useApiQuery } from '../../hooks/useApi';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';

interface Profile {
  email: string;
  fullName: string;
  phone: string | null;
  status: string;
  mfaEnabled: boolean;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  role: { code: string; name: string };
  emailChangeable: boolean;
  emailChangeNote: string;
}

interface SessionRow {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  absoluteExpiresAt: string;
  current: boolean;
}

export default function SettingsPage() {
  const { user, refresh } = useAuth();
  const profile = useApiQuery<Profile>('/me/profile');
  const sessions = useApiQuery<SessionRow[]>('/me/sessions');

  const profileAction = useAction();
  const passwordAction = useAction();
  const mfaAction = useAction();

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [profileSaved, setProfileSaved] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [passwordSaved, setPasswordSaved] = useState(false);

  useEffect(() => {
    if (profile.data) {
      setFullName(profile.data.fullName);
      setPhone(profile.data.phone ?? '');
    }
  }, [profile.data]);

  if (profile.loading) return <LoadingBlock />;

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    setProfileSaved(false);
    const result = await profileAction.run(() =>
      api.patch('/me/profile', { fullName, phone: phone || undefined }),
    );
    if (result !== null) {
      setProfileSaved(true);
      profile.reload();
      await refresh();
    }
  };

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    setPasswordSaved(false);
    const result = await passwordAction.run(() =>
      api.post('/auth/password/change', { currentPassword, newPassword }),
    );
    if (result !== null) {
      setPasswordSaved(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
      await refresh();
    }
  };

  const toggleMfa = async () => {
    const enabled = profile.data?.mfaEnabled ?? false;
    const result = await mfaAction.run(() =>
      api.post(enabled ? '/auth/mfa/disable' : '/auth/mfa/enable', { otp: '000000' }),
    );
    if (result !== null) {
      profile.reload();
      await refresh();
    }
  };

  const mismatch = confirmation.length > 0 && newPassword !== confirmation;

  return (
    <>
      <PageHeader title="Pengaturan" description="Profil, keamanan akun, dan sesi aktif." />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Profil">
          <form onSubmit={saveProfile} className="space-y-4">
            {profileAction.error && (
              <Alert tone="danger">
                {profileAction.error.map((message) => (
                  <p key={message}>{message}</p>
                ))}
              </Alert>
            )}
            {profileSaved && <Alert tone="success">Profil diperbarui.</Alert>}

            <Field label="Nama lengkap" required>
              <Input value={fullName} onChange={(event) => setFullName(event.target.value)} required />
            </Field>

            <Field label="Nomor telepon">
              <Input value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" />
            </Field>

            <Field label="Email" hint={profile.data?.emailChangeNote}>
              <Input value={profile.data?.email ?? ''} disabled readOnly />
            </Field>

            <Button type="submit" variant="primary" loading={profileAction.pending}>
              Simpan perubahan
            </Button>
          </form>
        </Card>

        <Card title="Keamanan">
          <form onSubmit={changePassword} className="space-y-4">
            {passwordAction.error && (
              <Alert tone="danger">
                {passwordAction.error.map((message) => (
                  <p key={message}>{message}</p>
                ))}
              </Alert>
            )}
            {passwordSaved && (
              <Alert tone="success">
                Kata sandi diperbarui. Sesi lain dikeluarkan; sesi ini tetap aktif.
              </Alert>
            )}

            <Field label="Kata sandi saat ini" required>
              <Input
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </Field>

            <Field label="Kata sandi baru" required hint="Minimal 10 karakter.">
              <Input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
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
              loading={passwordAction.pending}
              disabled={mismatch}
            >
              Ganti kata sandi
            </Button>
          </form>

          <hr className="my-6 border-hairline" />

          <div>
            <p className="font-medium">Verifikasi dua langkah lewat email</p>
            <p className="mt-1 text-sm text-ink-secondary">
              {profile.data?.mfaEnabled
                ? 'Aktif. Setiap kali masuk, Anda akan diminta kode dari email.'
                : 'Belum aktif. Mengaktifkannya menambah satu lapis perlindungan bila kata sandi Anda bocor.'}
            </p>
            {user?.isStaff && (
              <p className="mt-2 text-xs text-ink-muted">
                Akun internal wajib memakai verifikasi dua langkah, jadi pengaturan ini terkunci.
              </p>
            )}
            {mfaAction.error && (
              <div className="mt-3">
                <Alert tone="danger">
                  {mfaAction.error.map((message) => (
                    <p key={message}>{message}</p>
                  ))}
                </Alert>
              </div>
            )}
            <Button
              className="mt-3"
              variant={profile.data?.mfaEnabled ? 'secondary' : 'primary'}
              loading={mfaAction.pending}
              disabled={user?.isStaff}
              onClick={toggleMfa}
            >
              {profile.data?.mfaEnabled ? 'Nonaktifkan' : 'Aktifkan'}
            </Button>
          </div>
        </Card>
      </div>

      <div className="mt-6">
        <Card title="Sesi aktif" description="Perangkat yang sedang masuk ke akun Anda.">
          {sessions.loading && <LoadingBlock />}
          {sessions.data && (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Perangkat</th>
                    <th>Alamat IP</th>
                    <th>Mulai</th>
                    <th>Aktivitas terakhir</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.data.map((session) => (
                    <tr key={session.id}>
                      <td className="max-w-[280px]">
                        <p className="truncate">{session.userAgent ?? 'Tidak diketahui'}</p>
                        {session.current && (
                          <span className="mt-1 inline-block rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-success">
                            Sesi ini
                          </span>
                        )}
                      </td>
                      <td>{session.ipAddress ?? '—'}</td>
                      <td className="whitespace-nowrap">{formatDateTime(session.createdAt)}</td>
                      <td className="whitespace-nowrap">{formatDateTime(session.lastSeenAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-ink-muted">
            Mengganti kata sandi akan mengeluarkan seluruh sesi lain secara langsung.
          </p>
        </Card>
      </div>
    </>
  );
}
