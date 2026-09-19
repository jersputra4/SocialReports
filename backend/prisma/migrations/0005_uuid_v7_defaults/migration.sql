-- =============================================================================
-- 0005_uuid_v7_defaults — primary key memakai UUID v7 (BRD/SRS v1.1 §4.5)
--
-- UUID v7 = 48 bit timestamp milidetik + 74 bit acak (RFC 9562). Dibanding v4,
-- nilainya terurut waktu sehingga penyisipan pada index B-tree tetap berada di
-- ujung kanan — index tidak terfragmentasi ketika tabel report dan audit
-- tumbuh. Keacakan 74 bit tetap membuat nilai tidak dapat ditebak.
--
-- Default dipasang di database, bukan di aplikasi, agar berlaku juga untuk
-- penyisipan lewat migrasi, skrip pemeliharaan, dan impor data.
-- =============================================================================

CREATE OR REPLACE FUNCTION uuid_generate_v7()
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  v_time_ms BIGINT;
  v_bytes   BYTEA;
BEGIN
  v_time_ms := (extract(epoch FROM clock_timestamp()) * 1000)::BIGINT;

  -- 16 byte acak sebagai dasar, lalu 6 byte pertama ditimpa timestamp.
  v_bytes := gen_random_bytes(16);

  v_bytes := set_byte(v_bytes, 0, ((v_time_ms >> 40) & 255)::INTEGER);
  v_bytes := set_byte(v_bytes, 1, ((v_time_ms >> 32) & 255)::INTEGER);
  v_bytes := set_byte(v_bytes, 2, ((v_time_ms >> 24) & 255)::INTEGER);
  v_bytes := set_byte(v_bytes, 3, ((v_time_ms >> 16) & 255)::INTEGER);
  v_bytes := set_byte(v_bytes, 4, ((v_time_ms >> 8) & 255)::INTEGER);
  v_bytes := set_byte(v_bytes, 5, (v_time_ms & 255)::INTEGER);

  -- versi 7 pada nibble teratas oktet ke-7
  v_bytes := set_byte(v_bytes, 6, ((get_byte(v_bytes, 6) & 15) | 112));
  -- varian RFC 4122 pada 2 bit teratas oktet ke-9
  v_bytes := set_byte(v_bytes, 8, ((get_byte(v_bytes, 8) & 63) | 128));

  RETURN encode(v_bytes, 'hex')::UUID;
END;
$$;

-- gen_random_bytes() berasal dari pgcrypto.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Ganti seluruh default gen_random_uuid() menjadi uuid_generate_v7().
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_default = 'gen_random_uuid()'
  LOOP
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN %I SET DEFAULT uuid_generate_v7()',
      r.table_name, r.column_name);
  END LOOP;
END
$$;
