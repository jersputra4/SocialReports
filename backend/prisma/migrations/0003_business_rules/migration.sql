-- =============================================================================
-- 0003_business_rules — aturan bisnis yang dijaga database
--
-- Aplikasi sudah menjaga aturan yang sama, tetapi constraint di bawah membuat
-- pelanggaran tidak mungkin terjadi walaupun ada bug, migrasi data, atau akses
-- langsung ke database. Ini yang membuat AC-12, AC-26, dan NFR-12 terbukti.
-- =============================================================================

-- ------------------------------------------------- format kode report (AC-08)
-- Crockford base32 tanpa huruf I, L, O, U.
ALTER TABLE "reports"
  ADD CONSTRAINT "reports_report_code_format"
  CHECK ("report_code" ~ '^RPT-[0-9A-HJKMNP-TV-Z]{10}$');

-- ------------------------------------------ kelengkapan snapshot (NFR-12, AC-12)
-- Report yang sudah melewati DRAFT wajib punya snapshot harga, pajak, dan target.
ALTER TABLE "reports"
  ADD CONSTRAINT "reports_snapshot_complete"
  CHECK (
    "status" IN ('DRAFT', 'CANCELLED')
    OR (
      "unit_price_snapshot"   IS NOT NULL AND
      "subtotal_snapshot"     IS NOT NULL AND
      "tax_rate_bp_snapshot"  IS NOT NULL AND
      "tax_amount_snapshot"   IS NOT NULL AND
      "total_amount_snapshot" IS NOT NULL AND
      "target_snapshot_id"    IS NOT NULL AND
      "snapshot_sealed_at"    IS NOT NULL
    )
  );

ALTER TABLE "reports"
  ADD CONSTRAINT "reports_amounts_non_negative"
  CHECK (
    coalesce("unit_price_snapshot", 0)   >= 0 AND
    coalesce("subtotal_snapshot", 0)     >= 0 AND
    coalesce("tax_amount_snapshot", 0)   >= 0 AND
    coalesce("total_amount_snapshot", 0) >= 0 AND
    coalesce("tax_rate_bp_snapshot", 0)  >= 0 AND
    "package_quantity" > 0
  );

-- Konsistensi aritmetika snapshot: total = subtotal + pajak (BRD 6.1).
ALTER TABLE "reports"
  ADD CONSTRAINT "reports_total_equals_subtotal_plus_tax"
  CHECK (
    "total_amount_snapshot" IS NULL
    OR "total_amount_snapshot" = "subtotal_snapshot" + "tax_amount_snapshot"
  );

-- ------------------------------------- snapshot tidak dapat diubah (AC-12, C13)
CREATE OR REPLACE FUNCTION reports_protect_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."snapshot_sealed_at" IS NULL THEN
    RETURN NEW;  -- masih DRAFT, snapshot belum dibekukan
  END IF;

  IF ( NEW."unit_price_snapshot",   NEW."subtotal_snapshot",
       NEW."tax_rate_bp_snapshot",  NEW."tax_amount_snapshot",
       NEW."total_amount_snapshot", NEW."package_quantity",
       NEW."package_id",            NEW."action_type_id",
       NEW."target_snapshot_id",
       NEW."platform_name_snapshot", NEW."policy_name_snapshot",
       NEW."policy_version_snapshot", NEW."policy_text_snapshot",
       NEW."other_policy_reason",
       NEW."law_name_snapshot",      NEW."law_version_snapshot",
       NEW."article_number_snapshot", NEW."paragraph_number_snapshot",
       NEW."text_snapshot",          NEW."explanation_snapshot",
       NEW."other_legal_reason",     NEW."snapshot_sealed_at",
       NEW."report_code",            NEW."user_id"
     ) IS DISTINCT FROM
     ( OLD."unit_price_snapshot",   OLD."subtotal_snapshot",
       OLD."tax_rate_bp_snapshot",  OLD."tax_amount_snapshot",
       OLD."total_amount_snapshot", OLD."package_quantity",
       OLD."package_id",            OLD."action_type_id",
       OLD."target_snapshot_id",
       OLD."platform_name_snapshot", OLD."policy_name_snapshot",
       OLD."policy_version_snapshot", OLD."policy_text_snapshot",
       OLD."other_policy_reason",
       OLD."law_name_snapshot",      OLD."law_version_snapshot",
       OLD."article_number_snapshot", OLD."paragraph_number_snapshot",
       OLD."text_snapshot",          OLD."explanation_snapshot",
       OLD."other_legal_reason",     OLD."snapshot_sealed_at",
       OLD."report_code",            OLD."user_id"
     )
  THEN
    RAISE EXCEPTION
      'Snapshot report % tidak dapat diubah setelah status >= WAITING_PAYMENT', OLD."report_code"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER reports_snapshot_immutable
  BEFORE UPDATE ON "reports"
  FOR EACH ROW EXECUTE FUNCTION reports_protect_snapshot();

-- --------------------------- COMPLETED wajib punya bukti pengerjaan (AC-26)
CREATE OR REPLACE FUNCTION reports_require_active_proof()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_active_proofs INTEGER;
BEGIN
  IF NEW."status" = 'COMPLETED' AND OLD."status" IS DISTINCT FROM 'COMPLETED' THEN
    SELECT count(*) INTO v_active_proofs
    FROM "report_completion_proofs"
    WHERE "report_id" = NEW."report_id"
      AND "voided_at" IS NULL
      AND "visible_to_user" = true
      AND "scan_status" = 'CLEAN';

    IF v_active_proofs = 0 THEN
      RAISE EXCEPTION
        'Report % tidak dapat diselesaikan tanpa minimal satu bukti pengerjaan aktif yang terlihat user', NEW."report_code"
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER reports_completed_requires_proof
  BEFORE UPDATE ON "reports"
  FOR EACH ROW EXECUTE FUNCTION reports_require_active_proof();

-- ------------------------------------- rentang tarif tidak boleh tumpang tindih
-- BRD 5.2: "Rentang tanggal tidak boleh saling tumpang tindih".
ALTER TABLE "tax_config"
  ADD CONSTRAINT "tax_config_no_overlap"
  EXCLUDE USING gist (
    "tax_name" WITH =,
    tstzrange("effective_from", coalesce("effective_to", 'infinity'::timestamptz), '[)') WITH &&
  );

ALTER TABLE "pricing_config"
  ADD CONSTRAINT "pricing_config_no_overlap"
  EXCLUDE USING gist (
    tstzrange("effective_from", coalesce("effective_to", 'infinity'::timestamptz), '[)') WITH &&
  );

ALTER TABLE "tax_config"
  ADD CONSTRAINT "tax_config_rate_sane" CHECK ("rate_bp" >= 0 AND "rate_bp" <= 10000);
ALTER TABLE "pricing_config"
  ADD CONSTRAINT "pricing_config_price_positive" CHECK ("unit_price" > 0);

-- ------------------------------------------------------------ pembayaran ---
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amounts_non_negative"
  CHECK ("subtotal" >= 0 AND "tax_amount" >= 0 AND "total_amount" > 0
         AND "paid_amount" >= 0 AND "overpaid_amount" >= 0);

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_total_equals_subtotal_plus_tax"
  CHECK ("total_amount" = "subtotal" + "tax_amount");

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_total_equals_subtotal_plus_tax"
  CHECK ("total" = "subtotal" + "tax_amount");

-- Satu report hanya boleh punya satu pembayaran yang masih berjalan.
CREATE UNIQUE INDEX "payments_one_active_per_report"
  ON "payments" ("report_id")
  WHERE "status" IN ('PENDING', 'MANUAL_REVIEW');

-- ------------------------------------------------------ bukti pengerjaan ---
ALTER TABLE "report_completion_proofs"
  ADD CONSTRAINT "proofs_units_positive"
  CHECK ("units_reported" IS NULL OR "units_reported" > 0);

ALTER TABLE "report_completion_proofs"
  ADD CONSTRAINT "proofs_void_needs_reason"
  CHECK (("voided_at" IS NULL AND "void_reason" IS NULL AND "voided_by" IS NULL)
         OR ("voided_at" IS NOT NULL AND "void_reason" IS NOT NULL AND "voided_by" IS NOT NULL));

ALTER TABLE "report_completion_proofs"
  ADD CONSTRAINT "proofs_file_size_limit"
  CHECK ("file_size" > 0 AND "file_size" <= 5242880);

-- Waktu pelaporan tidak boleh di masa depan (BRD 8.2).
CREATE OR REPLACE FUNCTION proofs_reported_at_not_future()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."reported_at" > now() + interval '2 minutes' THEN
    RAISE EXCEPTION 'Waktu pelaporan tidak boleh di masa depan'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER proofs_reported_at_guard
  BEFORE INSERT OR UPDATE ON "report_completion_proofs"
  FOR EACH ROW EXECUTE FUNCTION proofs_reported_at_not_future();

-- ---------------------------------------------------------------- review ---
-- Alasan review wajib minimal 10 karakter (AC-21).
ALTER TABLE "review_decisions"
  ADD CONSTRAINT "review_decisions_reason_min_length"
  CHECK (char_length(btrim("reason")) >= 10);

-- -------------------------------------------------------------- evidence ---
ALTER TABLE "evidences"
  ADD CONSTRAINT "evidences_file_size_limit"
  CHECK ("file_size" > 0 AND "file_size" <= 5242880);
