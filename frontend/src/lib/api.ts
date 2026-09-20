/**
 * Klien API.
 *
 * Tiga hal yang ditangani di satu tempat:
 *   1. cookie sesi selalu ikut (`credentials: 'include'`);
 *   2. token CSRF dibaca dari cookie dan dikirim sebagai header pada setiap
 *      permintaan yang mengubah data (pola double submit);
 *   3. galat dari backend diterjemahkan menjadi objek yang dapat dipakai UI,
 *      termasuk kasus khusus 428 (butuh step-up MFA) dan 401 (sesi berakhir).
 */

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';
const CSRF_COOKIE = 'srs_csrf';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly error: string,
    message: string | string[],
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(Array.isArray(message) ? message.join(' ') : message);
    this.name = 'ApiError';
    this.messages = Array.isArray(message) ? message : [message];
  }

  readonly messages: string[];

  /** Tindakan sensitif menuntut OTP ulang (BRD 4.3). */
  get needsStepUp(): boolean {
    return this.status === 428 || this.error === 'StepUpMfaRequired';
  }

  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  get retryAfterSeconds(): number | undefined {
    const details = this.details as { retryAfterSeconds?: number } | undefined;
    return details?.retryAfterSeconds;
  }
}

function readCsrfToken(): string | null {
  const match = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith(`${CSRF_COOKIE}=`));
  return match ? decodeURIComponent(match.slice(CSRF_COOKIE.length + 1)) : null;
}

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();

/** Dipakai AuthContext untuk mengeluarkan pengguna ketika sesi berakhir. */
export function onUnauthorized(listener: Listener): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** FormData untuk unggahan berkas; Content-Type dibiarkan browser. */
  formData?: FormData;
  signal?: AbortSignal;
  /** Jangan picu logout otomatis (dipakai saat memeriksa sesi awal). */
  silentUnauthorized?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };

  if (method !== 'GET') {
    const csrf = readCsrfToken();
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }

  let body: BodyInit | undefined;
  if (options.formData) {
    body = options.formData;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body,
    credentials: 'include',
    signal: options.signal,
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload = text ? safeParse(text) : undefined;

  if (!response.ok) {
    const record = (payload ?? {}) as {
      error?: string;
      message?: string | string[];
      details?: unknown;
      requestId?: string;
    };

    const apiError = new ApiError(
      response.status,
      record.error ?? 'Error',
      record.message ?? 'Terjadi kesalahan. Silakan coba lagi.',
      record.details,
      record.requestId,
    );

    if (apiError.isUnauthenticated && !options.silentUnauthorized) {
      unauthorizedListeners.forEach((listener) => listener());
    }

    throw apiError;
  }

  return payload as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, formData: FormData) =>
    request<T>(path, { method: 'POST', formData }),
  getSilent: <T>(path: string) => request<T>(path, { silentUnauthorized: true }),
};
