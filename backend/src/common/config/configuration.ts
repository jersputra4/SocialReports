/**
 * Konfigurasi aplikasi.
 *
 * Seluruh nilai berasal dari environment. Tidak ada kredensial atau secret yang
 * ditulis di dalam kode (BRD/SRS v1.1 §4.1 / B6).
 */

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Nilai environment ${name} harus berupa bilangan bulat, diterima "${raw}"`);
  }
  return parsed;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1';
}

function str(name: string, fallback?: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Environment ${name} wajib diisi`);
  }
  return raw;
}

/**
 * Nilai `ADMIN_NOTIFY_DRIVER` yang diterima.
 *
 * Salah ketik dimatikan menjadi `none` alih-alih menggagalkan boot. Notifikasi
 * admin adalah kanal pendamping; satu huruf keliru di `.env` tidak boleh
 * menjatuhkan seluruh API. Nilai yang tidak dikenali dilaporkan ke stderr agar
 * tetap terlihat saat pemasangan.
 */
function parseAdminNotifyDriver(raw: string | undefined): 'none' | 'telegram' | 'whatsapp_cloud' {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === '' || value === 'none') return 'none';
  if (value === 'telegram') return 'telegram';
  if (value === 'whatsapp_cloud') return 'whatsapp_cloud';

  // eslint-disable-next-line no-console
  console.error(
    `ADMIN_NOTIFY_DRIVER "${raw}" tidak dikenali; notifikasi admin dimatikan. ` +
      `Nilai yang diterima: none, telegram, whatsapp_cloud.`,
  );
  return 'none';
}

export interface AppConfig {
  env: string;
  isProduction: boolean;
  appName: string;
  publicUrl: string;
  port: number;

  session: {
    secret: string;
    cookieName: string;
    csrfCookieName: string;
    cookieSecure: boolean;
    cookieDomain?: string;
    idleMinutesUser: number;
    idleMinutesAdmin: number;
    absoluteHoursUser: number;
    absoluteHoursAdmin: number;
    stepUpWindowMinutes: number;
  };

  security: {
    argon2MemoryKiB: number;
    argon2TimeCost: number;
    argon2Parallelism: number;
    passwordMinUser: number;
    passwordMinAdmin: number;
    lockoutThreshold: number;
    lockoutBaseMinutes: number;
    otpTtlMinutes: number;
    otpMaxAttempts: number;
    otpResendCooldownSeconds: number;
    otpMaxPer10Minutes: number;
    emailVerificationTtlHours: number;
    passwordResetTtlMinutes: number;
  };

  rateLimit: {
    loginPerMinute: number;
    apiPerMinute: number;
    uploadPerHour: number;
  };

  storage: {
    endpoint: string;
    /** Alamat yang dipakai untuk menandatangani URL unduh (dibuka peramban). */
    publicEndpoint: string;
    /** Algoritma enkripsi sisi server; kosong berarti header tidak dikirim. */
    serverSideEncryption: string | undefined;
    region: string;
    bucket: string;
    accessKey: string;
    secretKey: string;
    forcePathStyle: boolean;
    signedUrlTtlSeconds: number;
  };

  upload: {
    maxBytes: number;
    scanner: string;
  };

  mail: {
    driver: 'mailbox' | 'smtp';
    from: string;
    smtpHost?: string;
    smtpPort: number;
    smtpUser?: string;
    smtpPassword?: string;
  };

  payment: {
    driver: string;
    providerName: string;
    webhookSecret: string;
    expiryHours: number;
    retryWindowDays: number;
  };

  notification: {
    n8nWebhookUrl: string;
    n8nHmacSecret: string;
    timestampToleranceSeconds: number;
    outboxMaxAttempts: number;
  };

  fetcher: {
    url: string;
    serviceToken: string;
  };

  /**
   * Penerusan aduan ke Komdigi.
   *
   * Seluruhnya punya nilai bawaan yang aman: `enabled` mati, sehingga
   * pemasangan lama tetap jalan tanpa menambah satu pun variabel environment.
   */
  komdigi: {
    enabled: boolean;
    /** Alamat tujuan aduan. Wajib diisi bila `enabled` benar. */
    emailTo: string;
    senderName: string;
    senderAddress: string | null;
    senderEmail: string;
    senderPhone: string | null;
    /** Batas total lampiran per surat. Lebih ketat dari batas keras mailer. */
    maxAttachmentBytes: number;
    /** Pagar kecepatan: kiriman maksimum per 24 jam. */
    dailyLimit: number;
  };

  /**
   * Notifikasi admin ke kanal luar (Telegram atau WhatsApp).
   *
   * Dikirim oleh worker, BUKAN lewat zona Automation. Zona itu tidak
   * tersambung ke internet (`internal: true`) dan sengaja hanya menerima
   * payload minimal, sehingga tidak dapat — dan tidak boleh — membawa URL
   * target maupun kutipan kronologi.
   *
   * Bawaan `none`: pemasangan yang tidak mengisi apa pun tidak berubah
   * perilakunya dan tidak mengirim ke mana pun.
   */
  adminNotify: {
    driver: 'none' | 'telegram' | 'whatsapp_cloud';
    /** Event outbox yang memicu notifikasi. */
    events: string[];
    /** Panjang kutipan kronologi; dibatasi lagi oleh modul penyusun pesan. */
    excerptLength: number;
    /** Batas waktu satu permintaan ke kanal tujuan. */
    timeoutMs: number;
    telegram: {
      botToken: string;
      chatId: string;
    };
    whatsapp: {
      /** Versi Graph API, mis. `v21.0`. */
      graphVersion: string;
      phoneNumberId: string;
      accessToken: string;
      /** Nomor tujuan dalam format internasional tanpa tanda plus. */
      recipient: string;
      /** Nama template `utility` yang sudah disetujui Meta. */
      templateName: string;
      languageCode: string;
    };
  };

  redisUrl: string;
  databaseUrl: string;
}

export function loadConfiguration(): AppConfig {
  const env = str('NODE_ENV', 'development');
  const isProduction = env === 'production';

  return {
    env,
    isProduction,
    appName: str('APP_NAME', 'Sistem Pelaporan Konten'),
    publicUrl: str('APP_PUBLIC_URL', 'http://localhost:8080'),
    port: int('PORT', 3000),

    session: {
      secret: str('SESSION_SECRET'),
      cookieName: 'srs_session',
      csrfCookieName: 'srs_csrf',
      cookieSecure: bool('COOKIE_SECURE', isProduction),
      cookieDomain: process.env.COOKIE_DOMAIN || undefined,
      idleMinutesUser: int('SESSION_IDLE_MINUTES_USER', 30),
      idleMinutesAdmin: int('SESSION_IDLE_MINUTES_ADMIN', 15),
      absoluteHoursUser: int('SESSION_ABSOLUTE_HOURS_USER', 12),
      absoluteHoursAdmin: int('SESSION_ABSOLUTE_HOURS_ADMIN', 8),
      stepUpWindowMinutes: int('STEP_UP_MFA_WINDOW_MINUTES', 10),
    },

    security: {
      argon2MemoryKiB: int('ARGON2_MEMORY_KIB', 19456),
      argon2TimeCost: int('ARGON2_TIME_COST', 2),
      argon2Parallelism: int('ARGON2_PARALLELISM', 1),
      passwordMinUser: int('PASSWORD_MIN_LENGTH_USER', 10),
      passwordMinAdmin: int('PASSWORD_MIN_LENGTH_ADMIN', 12),
      lockoutThreshold: int('LOCKOUT_THRESHOLD', 5),
      lockoutBaseMinutes: int('LOCKOUT_BASE_MINUTES', 15),
      otpTtlMinutes: int('OTP_TTL_MINUTES', 5),
      otpMaxAttempts: int('OTP_MAX_ATTEMPTS', 5),
      otpResendCooldownSeconds: int('OTP_RESEND_COOLDOWN_SECONDS', 60),
      otpMaxPer10Minutes: int('OTP_MAX_PER_10_MINUTES', 3),
      emailVerificationTtlHours: int('EMAIL_VERIFICATION_TTL_HOURS', 24),
      passwordResetTtlMinutes: int('PASSWORD_RESET_TTL_MINUTES', 30),
    },

    rateLimit: {
      loginPerMinute: int('RATE_LIMIT_LOGIN_PER_MINUTE', 5),
      apiPerMinute: int('RATE_LIMIT_API_PER_MINUTE', 120),
      uploadPerHour: int('RATE_LIMIT_UPLOAD_PER_HOUR', 30),
    },

    storage: {
      endpoint: str('S3_ENDPOINT', 'http://localhost:9000'),
      // Alamat yang dipakai untuk MENANDATANGANI URL unduh. Berbeda dari
      // `endpoint` karena peramban tidak dapat meresolusi nama kontainer
      // Docker. Tanda tangan SigV4 mencakup host, jadi URL harus ditandatangani
      // memakai alamat yang benar-benar dibuka peramban.
      publicEndpoint: str('S3_PUBLIC_ENDPOINT', str('S3_ENDPOINT', 'http://localhost:9000')),
      // Kosong secara bawaan, dan itu disengaja.
      //
      // MinIO menolak header enkripsi sisi server dengan galat `NotImplemented`
      // selama KMS belum dikonfigurasi. Sebelumnya header ini dikirim tanpa
      // syarat, sehingga pemasangan baru yang belum menyiapkan KMS mendapati
      // SELURUH unggahan bukti gagal tanpa petunjuk yang jelas.
      //
      // Setel `S3_SSE=AES256` setelah KMS aktif (MinIO: `MINIO_KMS_SECRET_KEY`)
      // atau saat memakai Amazon S3, yang menerimanya tanpa konfigurasi
      // tambahan. Untuk data bukti pelanggaran, menyalakannya sangat
      // dianjurkan.
      serverSideEncryption: process.env.S3_SSE || undefined,
      region: str('S3_REGION', 'us-east-1'),
      bucket: str('S3_BUCKET', 'social-report'),
      accessKey: str('S3_ACCESS_KEY'),
      secretKey: str('S3_SECRET_KEY'),
      forcePathStyle: bool('S3_FORCE_PATH_STYLE', true),
      signedUrlTtlSeconds: Math.min(int('SIGNED_URL_TTL_SECONDS', 120), 120),
    },

    upload: {
      maxBytes: int('MAX_UPLOAD_BYTES', 5 * 1024 * 1024),
      scanner: str('MALWARE_SCANNER', 'mock'),
    },

    mail: {
      driver: (str('MAIL_DRIVER', 'mailbox') as 'mailbox' | 'smtp'),
      from: str('MAIL_FROM', 'Sistem Pelaporan Konten <no-reply@localhost>'),
      smtpHost: process.env.SMTP_HOST || undefined,
      smtpPort: int('SMTP_PORT', 587),
      smtpUser: process.env.SMTP_USER || undefined,
      smtpPassword: process.env.SMTP_PASSWORD || undefined,
    },

    payment: {
      driver: str('PAYMENT_DRIVER', 'mock'),
      providerName: str('PAYMENT_PROVIDER_NAME', 'mockpay'),
      webhookSecret: str('PAYMENT_WEBHOOK_SECRET'),
      expiryHours: int('PAYMENT_EXPIRY_HOURS', 24),
      retryWindowDays: int('PAYMENT_RETRY_WINDOW_DAYS', 7),
    },

    notification: {
      n8nWebhookUrl: str('N8N_WEBHOOK_URL', 'http://localhost:4002/webhook/report-events'),
      n8nHmacSecret: str('N8N_HMAC_SECRET'),
      timestampToleranceSeconds: int('N8N_TIMESTAMP_TOLERANCE_SECONDS', 300),
      outboxMaxAttempts: int('OUTBOX_MAX_ATTEMPTS', 8),
    },

    fetcher: {
      url: str('FETCHER_URL', 'http://localhost:4001'),
      serviceToken: str('FETCHER_SERVICE_TOKEN'),
    },

    komdigi: {
      enabled: bool('KOMDIGI_ENABLED', false),
      emailTo: str('KOMDIGI_EMAIL_TO', ''),
      senderName: str('KOMDIGI_SENDER_NAME', str('APP_NAME', 'Sistem Pelaporan Konten')),
      senderAddress: process.env.KOMDIGI_SENDER_ADDRESS || null,
      senderEmail: str('KOMDIGI_SENDER_EMAIL', str('MAIL_FROM', 'no-reply@localhost')),
      senderPhone: process.env.KOMDIGI_SENDER_PHONE || null,
      maxAttachmentBytes: int('KOMDIGI_MAX_ATTACHMENT_MB', 8) * 1024 * 1024,
      dailyLimit: int('KOMDIGI_DAILY_LIMIT', 20),
    },

    adminNotify: {
      driver: parseAdminNotifyDriver(process.env.ADMIN_NOTIFY_DRIVER),
      // Bawaan REPORT_CREATED: admin diberi tahu begitu report dibuat.
      // Sebagian pemasangan lebih suka PAYMENT_VERIFIED, karena report yang
      // belum dibayar sering ditinggalkan dan hanya menambah kebisingan.
      events: str('ADMIN_NOTIFY_EVENTS', 'REPORT_CREATED')
        .split(',')
        .map((value) => value.trim().toUpperCase())
        .filter((value) => value.length > 0),
      excerptLength: int('ADMIN_NOTIFY_EXCERPT_LENGTH', 200),
      timeoutMs: int('ADMIN_NOTIFY_TIMEOUT_MS', 10_000),
      telegram: {
        botToken: str('TELEGRAM_BOT_TOKEN', ''),
        chatId: str('TELEGRAM_CHAT_ID', ''),
      },
      whatsapp: {
        graphVersion: str('WHATSAPP_GRAPH_VERSION', 'v21.0'),
        phoneNumberId: str('WHATSAPP_PHONE_NUMBER_ID', ''),
        accessToken: str('WHATSAPP_ACCESS_TOKEN', ''),
        recipient: str('ADMIN_WHATSAPP_NUMBER', ''),
        templateName: str('WHATSAPP_TEMPLATE_NAME', 'report_baru'),
        languageCode: str('WHATSAPP_TEMPLATE_LANGUAGE', 'id'),
      },
    },

    redisUrl: str('REDIS_URL', 'redis://localhost:6379'),
    databaseUrl: str('DATABASE_URL'),
  };
}

export const CONFIG_TOKEN = 'APP_CONFIG';
