/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Basis URL API. Di belakang reverse proxy nilainya /api/v1. */
  readonly VITE_API_BASE_URL?: string;
  /**
   * Nomor WhatsApp layanan pelanggan, format internasional tanpa tanda plus.
   * Kosong berarti tombol "Hubungi kami" tidak ditampilkan.
   */
  readonly VITE_WHATSAPP_NUMBER?: string;
  /** Teks awal yang sudah terisi di kolom pesan WhatsApp. */
  readonly VITE_WHATSAPP_MESSAGE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
