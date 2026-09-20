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

    redisUrl: str('REDIS_URL', 'redis://localhost:6379'),
    databaseUrl: str('DATABASE_URL'),
  };
}

export const CONFIG_TOKEN = 'APP_CONFIG';
