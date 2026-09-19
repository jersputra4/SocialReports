import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api';

interface QueryState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/**
 * Pengambilan data sederhana dengan pembatalan otomatis.
 *
 * Tidak memakai pustaka cache: halaman di sini memuat data saat dibuka dan
 * memuat ulang setelah aksi, sehingga status yang ditampilkan selalu berasal
 * dari server — bukan dari tebakan di sisi klien.
 */
export function useApiQuery<T>(path: string | null, deps: unknown[] = []): QueryState<T> & {
  reload: () => void;
} {
  const [state, setState] = useState<QueryState<T>>({ data: null, loading: true, error: null });
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (!path) {
      setState({ data: null, loading: false, error: null });
      return undefined;
    }

    const controller = new AbortController();
    setState((current) => ({ ...current, loading: true, error: null }));

    api
      .get<T>(path, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ data, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          data: null,
          loading: false,
          error: error instanceof ApiError ? error.message : 'Gagal memuat data.',
        });
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, nonce, ...deps]);

  return { ...state, reload };
}

/** Pemanggilan aksi dengan status kirim dan pesan galat siap pakai. */
export function useAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string[] | null>(null);

  const run = useCallback(
    async <T>(action: () => Promise<T>): Promise<T | null> => {
      setPending(true);
      setError(null);
      try {
        return await action();
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.messages : ['Terjadi kesalahan.']);
        return null;
      } finally {
        setPending(false);
      }
    },
    [],
  );

  return { run, pending, error, clearError: () => setError(null) };
}
