-- =============================================================================
-- 0004_app_role_grants — pemisahan hak akses database (BRD/SRS v1.1 §4.5)
--
-- Migrasi dijalankan oleh pemilik schema. Aplikasi sebaiknya tersambung memakai
-- role `srs_app` yang dibuat di sini: role itu TIDAK punya UPDATE/DELETE pada
-- audit_logs. Trigger di 0002 tetap menjadi lapisan kedua sehingga aturan
-- append-only berlaku juga bila aplikasi terlanjur tersambung sebagai pemilik.
--
-- Cara memakai di lingkungan nyata:
--   ALTER ROLE srs_app LOGIN PASSWORD '<dari secret manager>';
--   DATABASE_URL=postgresql://srs_app:<password>@host:5432/social_report
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'srs_app') THEN
    CREATE ROLE srs_app NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO srs_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO srs_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO srs_app;

-- audit_logs: hanya INSERT dan SELECT (BRD 4.5).
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "audit_logs" FROM srs_app;

-- Tabel master hukum/policy dan konfigurasi harga tetap dapat ditulis aplikasi
-- karena perubahannya melewati endpoint ber-izin `pricing.manage` / `legal.*`
-- dan tercatat di audit log.

-- Objek baru di masa depan mewarisi hak yang sama.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO srs_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO srs_app;
