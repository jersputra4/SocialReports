-- Kanal notifikasi admin: Telegram dan WhatsApp.
--
-- Hanya menambah nilai enum. PostgreSQL 16 mengizinkan ALTER TYPE ... ADD VALUE
-- di dalam transaksi selama nilai barunya tidak dipakai pada transaksi yang
-- sama; migrasi ini memang tidak memakainya.
ALTER TYPE "NotificationChannel" ADD VALUE IF NOT EXISTS 'TELEGRAM_ADMIN';
ALTER TYPE "NotificationChannel" ADD VALUE IF NOT EXISTS 'WHATSAPP_ADMIN';
