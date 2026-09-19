-- =============================================================================
-- 0007_resnapshot_on_retry — pengecualian terbatas pada pembekuan snapshot
--
-- Dua aturan dokumen tampak berbenturan:
--   * BRD 6.2  — perubahan pricing_config/tax_config tidak mengubah report yang
--                sudah berstatus >= WAITING_PAYMENT;
--   * BRD 7.2 baris 9 dan 10 — ketika user membuat tagihan baru setelah order
--                kedaluwarsa atau pembayaran ditolak, "harga dihitung ulang".
--
-- Keduanya berdamai bila pembekuan dibaca sebagai: report yang sedang berjalan
-- tidak boleh berubah karena perubahan konfigurasi, tetapi report yang
-- tagihannya sudah gugur boleh dikuotasi ulang ketika user sendiri meminta
-- tagihan baru.
--
-- Karena itu trigger melepas penguncian HANYA pada dua status gugur tersebut.
-- Di status lain snapshot tetap tidak dapat disentuh, dan setiap penguotaan
-- ulang tetap tercatat di audit log serta riwayat status.
-- =============================================================================

CREATE OR REPLACE FUNCTION reports_protect_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."snapshot_sealed_at" IS NULL THEN
    RETURN NEW;  -- masih DRAFT, snapshot belum dibekukan
  END IF;

  -- Tagihan sudah gugur: user boleh meminta tagihan baru dengan harga terkini.
  IF OLD."status" IN ('EXPIRED', 'PAYMENT_REJECTED') THEN
    RETURN NEW;
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
       NEW."other_legal_reason",
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
       OLD."other_legal_reason",
       OLD."report_code",            OLD."user_id"
     )
  THEN
    RAISE EXCEPTION
      'Snapshot report % tidak dapat diubah pada status %', OLD."report_code", OLD."status"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END;
$$;
