import {
  PropsWithChildren,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { ApiError, api, onUnauthorized } from '../lib/api';

export interface CurrentUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  isStaff: boolean;
  permissions: string[];
  mustChangePassword: boolean;
  stepUpValidUntil: string | null;
}

export type LoginOutcome =
  | { kind: 'SESSION' }
  | { kind: 'MFA_REQUIRED'; challengeId: string; expiresAt: string };

interface AuthContextValue {
  user: CurrentUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<LoginOutcome>;
  verifyMfa: (challengeId: string, otp: string) => Promise<void>;
  resendMfa: (challengeId: string) => Promise<{ challengeId: string; expiresAt: string }>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  can: (permission: string) => boolean;
  stepUpValid: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await api.getSilent<CurrentUser>('/auth/me');
      setUser(me);
    } catch (error) {
      if (error instanceof ApiError && error.isUnauthenticated) {
        setUser(null);
      } else {
        setUser(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Sesi yang berakhir di tengah pemakaian langsung mengembalikan pengguna ke
  // halaman masuk, tanpa menunggu permintaan berikutnya gagal lagi.
  useEffect(() => onUnauthorized(() => setUser(null)), []);

  const login = useCallback<AuthContextValue['login']>(async (email, password) => {
    const result = await api.post<{
      mfaRequired: boolean;
      challengeId?: string;
      expiresAt?: string;
    }>('/auth/login', { email, password });

    if (result.mfaRequired && result.challengeId) {
      return {
        kind: 'MFA_REQUIRED',
        challengeId: result.challengeId,
        expiresAt: result.expiresAt ?? '',
      };
    }

    await refresh();
    return { kind: 'SESSION' };
  }, [refresh]);

  const verifyMfa = useCallback<AuthContextValue['verifyMfa']>(
    async (challengeId, otp) => {
      await api.post('/auth/mfa/verify', { challengeId, otp });
      await refresh();
    },
    [refresh],
  );

  const resendMfa = useCallback<AuthContextValue['resendMfa']>(async (challengeId) => {
    return api.post<{ challengeId: string; expiresAt: string }>('/auth/mfa/resend', {
      challengeId,
    });
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const validUntil = user?.stepUpValidUntil;

    return {
      user,
      loading,
      login,
      verifyMfa,
      resendMfa,
      logout,
      refresh,
      can: (permission: string) => user?.permissions.includes(permission) ?? false,
      // Jendela step-up dihitung ulang setiap render agar tombol yang menuntut
      // konfirmasi tidak terlihat aktif setelah jendelanya lewat.
      stepUpValid: validUntil ? new Date(validUntil).getTime() > Date.now() : false,
    };
  }, [user, loading, login, verifyMfa, resendMfa, logout, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth harus dipakai di dalam AuthProvider.');
  return context;
}
