/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Basis URL API. Di belakang reverse proxy nilainya /api/v1. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
