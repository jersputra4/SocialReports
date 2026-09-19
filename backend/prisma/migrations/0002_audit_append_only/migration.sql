-- =============================================================================
-- 0002_audit_append_only — integritas audit log (BRD/SRS v1.1 §4.5)
--
--   * Tabel audit_logs append-only: UPDATE dan DELETE diblokir trigger,
--     sehingga berlaku untuk SEMUA role, termasuk pemilik tabel.
--   * Rantai hash dihitung di database dalam BEFORE INSERT trigger sehingga
--     tidak bergantung pada kebenaran kode aplikasi dan tetap konsisten
--     walaupun ada beberapa instance API yang menulis bersamaan.
--     entry_hash = SHA-256(prev_hash || canonical(entry))
-- =============================================================================

-- Representasi kanonik satu entri audit.
-- Urutan field dikunci di sini; jsonb::text sudah dinormalisasi PostgreSQL
-- sehingga hasilnya deterministik untuk nilai yang sama.
CREATE OR REPLACE FUNCTION audit_canonical_entry(
  p_seq          BIGINT,
  p_occurred_at  TIMESTAMPTZ,
  p_actor_id     UUID,
  p_actor_role   VARCHAR,
  p_ip_address   VARCHAR,
  p_user_agent   VARCHAR,
  p_action       VARCHAR,
  p_entity_type  VARCHAR,
  p_entity_id    VARCHAR,
  p_before_json  JSONB,
  p_after_json   JSONB,
  p_request_id   VARCHAR
) RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    p_seq::text                                                              || E'\x1f' ||
    to_char(p_occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || E'\x1f' ||
    coalesce(p_actor_id::text, '')                                           || E'\x1f' ||
    coalesce(p_actor_role, '')                                               || E'\x1f' ||
    coalesce(p_ip_address, '')                                               || E'\x1f' ||
    coalesce(p_user_agent, '')                                               || E'\x1f' ||
    p_action                                                                 || E'\x1f' ||
    coalesce(p_entity_type, '')                                              || E'\x1f' ||
    coalesce(p_entity_id, '')                                                || E'\x1f' ||
    coalesce(p_before_json::text, '')                                        || E'\x1f' ||
    coalesce(p_after_json::text, '')                                         || E'\x1f' ||
    coalesce(p_request_id, '')
$$;

CREATE OR REPLACE FUNCTION audit_logs_chain_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_prev_hash VARCHAR(64);
  v_canonical TEXT;
BEGIN
  -- Serialisasi penulisan rantai. Lock dilepas saat transaksi selesai.
  PERFORM pg_advisory_xact_lock(hashtext('audit_logs_hash_chain'));

  SELECT entry_hash INTO v_prev_hash
  FROM audit_logs
  ORDER BY seq DESC
  LIMIT 1;

  IF v_prev_hash IS NULL THEN
    -- Genesis: 64 karakter nol.
    v_prev_hash := repeat('0', 64);
  END IF;

  v_canonical := audit_canonical_entry(
    NEW.seq, NEW.occurred_at, NEW.actor_id, NEW.actor_role, NEW.ip_address,
    NEW.user_agent, NEW.action, NEW.entity_type, NEW.entity_id,
    NEW.before_json, NEW.after_json, NEW.request_id
  );

  NEW.prev_hash  := v_prev_hash;
  NEW.entry_hash := encode(sha256(convert_to(v_prev_hash || v_canonical, 'UTF8')), 'hex');

  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_logs_chain
  BEFORE INSERT ON audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION audit_logs_chain_before_insert();

-- --------------------------------------------------------------- append-only
CREATE OR REPLACE FUNCTION audit_logs_block_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'audit_logs bersifat append-only: operasi % ditolak', TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER audit_logs_no_update
  BEFORE UPDATE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_mutation();

CREATE TRIGGER audit_logs_no_delete
  BEFORE DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_mutation();

CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON audit_logs
  EXECUTE FUNCTION audit_logs_block_mutation();

-- ------------------------------------------------------------- verifikasi ---
-- Mengembalikan baris pertama yang rusak. Tidak mengembalikan apa pun bila
-- seluruh rantai konsisten. Dipakai job harian dan CLI verify-audit-chain.
CREATE OR REPLACE FUNCTION audit_verify_chain(p_from_seq BIGINT DEFAULT 0)
RETURNS TABLE (bad_seq BIGINT, bad_audit_id UUID, reason TEXT)
LANGUAGE plpgsql
AS $$
DECLARE
  r              RECORD;
  v_expected_prev VARCHAR(64);
  v_expected_hash VARCHAR(64);
BEGIN
  SELECT coalesce(
           (SELECT entry_hash FROM audit_logs WHERE seq < p_from_seq ORDER BY seq DESC LIMIT 1),
           repeat('0', 64))
    INTO v_expected_prev;

  FOR r IN SELECT * FROM audit_logs WHERE seq >= p_from_seq ORDER BY seq ASC LOOP
    IF r.prev_hash <> v_expected_prev THEN
      bad_seq := r.seq; bad_audit_id := r.audit_id;
      reason := 'prev_hash tidak cocok dengan entry_hash baris sebelumnya';
      RETURN NEXT;
      RETURN;
    END IF;

    v_expected_hash := encode(
      sha256(convert_to(
        r.prev_hash || audit_canonical_entry(
          r.seq, r.occurred_at, r.actor_id, r.actor_role, r.ip_address,
          r.user_agent, r.action, r.entity_type, r.entity_id,
          r.before_json, r.after_json, r.request_id),
        'UTF8')), 'hex');

    IF r.entry_hash <> v_expected_hash THEN
      bad_seq := r.seq; bad_audit_id := r.audit_id;
      reason := 'entry_hash tidak cocok dengan isi baris (baris diubah)';
      RETURN NEXT;
      RETURN;
    END IF;

    v_expected_prev := r.entry_hash;
  END LOOP;

  RETURN;
END;
$$;
