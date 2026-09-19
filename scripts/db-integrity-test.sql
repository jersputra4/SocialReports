-- =============================================================================
-- Uji integritas lapisan database.
-- Menjalankan aturan yang dijanjikan BRD/SRS v1.1 terhadap database sungguhan.
--
--   psql -v ON_ERROR_STOP=1 -f scripts/db-integrity-test.sql
--
-- Setiap pemeriksaan mencetak PASS atau menghentikan skrip dengan FAIL.
-- Seluruh pekerjaan dilakukan dalam satu transaksi yang di-rollback di akhir,
-- sehingga aman dijalankan terhadap database yang sudah berisi data seed.
-- =============================================================================

\set ON_ERROR_STOP on
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.expect_fail(p_label TEXT, p_sql TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'PASS  %  (ditolak: %)', p_label, left(replace(SQLERRM, E'\n', ' '), 90);
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL  % — operasi seharusnya ditolak tetapi berhasil', p_label;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.expect_ok(p_label TEXT, p_sql TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RAISE NOTICE 'PASS  %', p_label;
END;
$$;

-- ---------------------------------------------------------------- fixtures --
CREATE TEMP TABLE t_ids (k TEXT PRIMARY KEY, v UUID);

DO $$
DECLARE
  v_role UUID; v_user UUID; v_pkg UUID; v_action UUID; v_target UUID; v_report UUID;
BEGIN
  INSERT INTO roles (code, name, is_staff) VALUES ('t_user', 'Uji User', false) RETURNING role_id INTO v_role;
  INSERT INTO users (email, full_name, password_hash, role_id, status, email_verified_at)
    VALUES ('uji@example.test', 'Uji', 'x', v_role, 'ACTIVE', now()) RETURNING user_id INTO v_user;
  INSERT INTO packages (code, quantity) VALUES ('T300', 300) RETURNING package_id INTO v_pkg;
  INSERT INTO action_types (code, name) VALUES ('T_REPORT_POST', 'Uji') RETURNING action_type_id INTO v_action;
  INSERT INTO target_snapshots (original_url, fetch_status)
    VALUES ('https://x.com/contoh/status/1', 'MANUAL') RETURNING target_snapshot_id INTO v_target;

  INSERT INTO reports (
    report_code, user_id, status, action_type_id, package_id, package_quantity,
    target_snapshot_id, unit_price_snapshot, subtotal_snapshot, tax_rate_bp_snapshot,
    tax_amount_snapshot, total_amount_snapshot, snapshot_sealed_at)
  VALUES (
    'RPT-A1B2C3D4E5', v_user, 'WAITING_PAYMENT', v_action, v_pkg, 300,
    v_target, 1000, 300000, 1100, 33000, 333000, now())
  RETURNING report_id INTO v_report;

  INSERT INTO t_ids VALUES ('role', v_role), ('user', v_user), ('pkg', v_pkg),
                           ('action', v_action), ('target', v_target), ('report', v_report);
END
$$;

-- ==================================================== 1. audit append-only ==
DO $$
DECLARE v_actor UUID;
BEGIN
  SELECT v INTO v_actor FROM t_ids WHERE k = 'user';
  INSERT INTO audit_logs (actor_id, actor_role, action, entity_type, entity_id, after_json, prev_hash, entry_hash)
  VALUES (v_actor, 'user', 'LOGIN', 'user', v_actor::text, '{"ok":true}'::jsonb, '', '');
  INSERT INTO audit_logs (actor_id, actor_role, action, entity_type, entity_id, after_json, prev_hash, entry_hash)
  VALUES (v_actor, 'user', 'CREATE_REPORT', 'report', 'RPT-A1B2C3D4E5', '{"status":"DRAFT"}'::jsonb, '', '');
  INSERT INTO audit_logs (actor_id, actor_role, action, entity_type, entity_id, after_json, prev_hash, entry_hash)
  VALUES (v_actor, 'user', 'STATUS_CHANGE', 'report', 'RPT-A1B2C3D4E5', '{"to":"WAITING_PAYMENT"}'::jsonb, '', '');
  RAISE NOTICE 'PASS  audit: 3 entri tercatat';
END
$$;

-- prev_hash/entry_hash diisi trigger, bukan nilai kosong yang dikirim aplikasi.
DO $$
DECLARE v_bad INTEGER;
BEGIN
  SELECT count(*) INTO v_bad FROM audit_logs WHERE entry_hash = '' OR length(entry_hash) <> 64;
  IF v_bad > 0 THEN RAISE EXCEPTION 'FAIL  audit: % entri tanpa hash yang benar', v_bad; END IF;
  RAISE NOTICE 'PASS  audit: entry_hash dihitung database (64 hex)';
END
$$;

SELECT pg_temp.expect_fail('audit: UPDATE ditolak',
  $q$ UPDATE audit_logs SET action = 'DIUBAH' WHERE action = 'LOGIN' $q$);

SELECT pg_temp.expect_fail('audit: DELETE ditolak',
  $q$ DELETE FROM audit_logs WHERE action = 'LOGIN' $q$);

DO $$
DECLARE v_rows INTEGER;
BEGIN
  SELECT count(*) INTO v_rows FROM audit_verify_chain(0);
  IF v_rows <> 0 THEN RAISE EXCEPTION 'FAIL  audit: rantai hash tidak konsisten'; END IF;
  RAISE NOTICE 'PASS  audit: verifikasi rantai hash lulus';
END
$$;

-- Simulasi penyerang dengan hak setinggi pemilik tabel: trigger dimatikan dan
-- satu baris diubah langsung. Verifikasi harus menemukannya (AC-33).
DO $$
DECLARE v_seq BIGINT; v_rows INTEGER; v_reason TEXT;
BEGIN
  ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_update;
  SELECT seq INTO v_seq FROM audit_logs ORDER BY seq ASC LIMIT 1;
  UPDATE audit_logs SET action = 'LOGIN_DIPALSUKAN' WHERE seq = v_seq;
  ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_no_update;

  SELECT count(*), min(reason) INTO v_rows, v_reason FROM audit_verify_chain(0);
  IF v_rows = 0 THEN RAISE EXCEPTION 'FAIL  audit: perubahan manual tidak terdeteksi'; END IF;
  RAISE NOTICE 'PASS  audit: perubahan satu baris terdeteksi (%)', v_reason;
END
$$;

-- ================================================ 2. snapshot tidak berubah ==
SELECT pg_temp.expect_fail('report: harga snapshot tidak dapat diubah',
  $q$ UPDATE reports SET unit_price_snapshot = 2000 WHERE report_code = 'RPT-A1B2C3D4E5' $q$);

SELECT pg_temp.expect_fail('report: paket snapshot tidak dapat diubah',
  $q$ UPDATE reports SET package_quantity = 1500 WHERE report_code = 'RPT-A1B2C3D4E5' $q$);

SELECT pg_temp.expect_ok('report: perubahan status tetap diizinkan',
  $q$ UPDATE reports SET status = 'PAID' WHERE report_code = 'RPT-A1B2C3D4E5' $q$);

-- Pengecualian terbatas (migrasi 0007): setelah tagihan gugur, report boleh
-- dikuotasi ulang dengan harga terkini.
SELECT pg_temp.expect_ok('report: masuk status EXPIRED',
  $q$ UPDATE reports SET status = 'EXPIRED', expired_at = now() WHERE report_code = 'RPT-A1B2C3D4E5' $q$);

SELECT pg_temp.expect_ok('report: kuotasi ulang diizinkan saat EXPIRED',
  $q$ UPDATE reports SET unit_price_snapshot = 1200, subtotal_snapshot = 360000,
        tax_amount_snapshot = 39600, total_amount_snapshot = 399600
      WHERE report_code = 'RPT-A1B2C3D4E5' $q$);

SELECT pg_temp.expect_ok('report: kembali menunggu pembayaran',
  $q$ UPDATE reports SET status = 'WAITING_PAYMENT' WHERE report_code = 'RPT-A1B2C3D4E5' $q$);

SELECT pg_temp.expect_fail('report: snapshot beku lagi setelah tagihan baru',
  $q$ UPDATE reports SET unit_price_snapshot = 5000 WHERE report_code = 'RPT-A1B2C3D4E5' $q$);

SELECT pg_temp.expect_ok('report: lanjut ke PAID untuk pemeriksaan berikutnya',
  $q$ UPDATE reports SET status = 'PAID' WHERE report_code = 'RPT-A1B2C3D4E5' $q$);

-- =============================================== 3. kelengkapan snapshot ====
SELECT pg_temp.expect_fail('report: status > DRAFT tanpa snapshot ditolak',
  $q$ INSERT INTO reports (report_code, user_id, status, action_type_id, package_id, package_quantity)
      SELECT 'RPT-Z9Y8X7W6V5', (SELECT v FROM t_ids WHERE k='user'), 'WAITING_PAYMENT',
             (SELECT v FROM t_ids WHERE k='action'), (SELECT v FROM t_ids WHERE k='pkg'), 300 $q$);

SELECT pg_temp.expect_fail('report: kode report di luar format ditolak',
  $q$ INSERT INTO reports (report_code, user_id, status, action_type_id, package_id, package_quantity)
      SELECT 'RPT-000001', (SELECT v FROM t_ids WHERE k='user'), 'DRAFT',
             (SELECT v FROM t_ids WHERE k='action'), (SELECT v FROM t_ids WHERE k='pkg'), 300 $q$);

SELECT pg_temp.expect_fail('report: total != subtotal + PPN ditolak',
  $q$ INSERT INTO reports (report_code, user_id, status, action_type_id, package_id, package_quantity,
                           target_snapshot_id, unit_price_snapshot, subtotal_snapshot, tax_rate_bp_snapshot,
                           tax_amount_snapshot, total_amount_snapshot, snapshot_sealed_at)
      SELECT 'RPT-Q1W2E3R4T5', (SELECT v FROM t_ids WHERE k='user'), 'WAITING_PAYMENT',
             (SELECT v FROM t_ids WHERE k='action'), (SELECT v FROM t_ids WHERE k='pkg'), 300,
             (SELECT v FROM t_ids WHERE k='target'), 1000, 300000, 1100, 33000, 999999, now() $q$);

-- ========================================= 4. COMPLETED wajib ada bukti =====
SELECT pg_temp.expect_ok('report: masuk status SUBMITTED',
  $q$ UPDATE reports SET status = 'SUBMITTED' WHERE report_code = 'RPT-A1B2C3D4E5' $q$);

SELECT pg_temp.expect_fail('report: COMPLETED tanpa bukti pengerjaan ditolak',
  $q$ UPDATE reports SET status = 'COMPLETED' WHERE report_code = 'RPT-A1B2C3D4E5' $q$);

DO $$
BEGIN
  INSERT INTO report_completion_proofs (
    report_id, uploaded_by, proof_type, reported_at, file_name, file_type,
    file_size, file_hash, storage_path, scan_status, visible_to_user)
  VALUES (
    (SELECT v FROM t_ids WHERE k='report'), (SELECT v FROM t_ids WHERE k='user'),
    'POST_REPORTED', now() - interval '1 hour', 'bukti.png', 'image/png',
    2048, repeat('a', 64), 'proofs/x/y.png', 'CLEAN', true);
  RAISE NOTICE 'PASS  bukti pengerjaan: unggahan tercatat';
END
$$;

SELECT pg_temp.expect_ok('report: COMPLETED berhasil setelah ada bukti aktif',
  $q$ UPDATE reports SET status = 'COMPLETED' WHERE report_code = 'RPT-A1B2C3D4E5' $q$);

SELECT pg_temp.expect_fail('bukti: waktu pelaporan di masa depan ditolak',
  $q$ UPDATE report_completion_proofs SET reported_at = now() + interval '2 days' $q$);

SELECT pg_temp.expect_fail('bukti: void tanpa alasan ditolak',
  $q$ UPDATE report_completion_proofs SET voided_at = now() $q$);

-- ====================================== 5. rentang tarif tidak tumpang tindih
SELECT pg_temp.expect_ok('tax_config: tarif PPN 11% berlaku sejak 2025-01-01',
  $q$ INSERT INTO tax_config (tax_name, rate_bp, effective_from)
      VALUES ('PPN_UJI', 1100, '2025-01-01T00:00:00Z') $q$);

SELECT pg_temp.expect_fail('tax_config: rentang tumpang tindih ditolak',
  $q$ INSERT INTO tax_config (tax_name, rate_bp, effective_from)
      VALUES ('PPN_UJI', 1200, '2026-01-01T00:00:00Z') $q$);

SELECT pg_temp.expect_fail('tax_config: tarif di luar 0..100% ditolak',
  $q$ INSERT INTO tax_config (tax_name, rate_bp, effective_from)
      VALUES ('PPN_LAIN', 20000, '2030-01-01T00:00:00Z') $q$);

-- ============================================= 6. satu pembayaran aktif =====
DO $$
BEGIN
  INSERT INTO payments (report_id, provider, gateway_order_id, subtotal, tax_amount,
                        total_amount, status, expires_at)
  VALUES ((SELECT v FROM t_ids WHERE k='report'), 'mockpay', 'ORD-UJI-1',
          300000, 33000, 333000, 'PENDING', now() + interval '24 hours');
  RAISE NOTICE 'PASS  payment: order pertama dibuat';
END
$$;

SELECT pg_temp.expect_fail('payment: dua order aktif untuk satu report ditolak',
  $q$ INSERT INTO payments (report_id, provider, gateway_order_id, subtotal, tax_amount,
                            total_amount, status, expires_at)
      VALUES ((SELECT v FROM t_ids WHERE k='report'), 'mockpay', 'ORD-UJI-2',
              300000, 33000, 333000, 'PENDING', now() + interval '24 hours') $q$);

SELECT pg_temp.expect_fail('payment: total tidak sama dengan subtotal + PPN ditolak',
  $q$ INSERT INTO payments (report_id, provider, gateway_order_id, subtotal, tax_amount,
                            total_amount, status, expires_at)
      VALUES ((SELECT v FROM t_ids WHERE k='report'), 'mockpay', 'ORD-UJI-3',
              300000, 33000, 400000, 'SETTLED', now() + interval '24 hours') $q$);

-- ============================================ 7. dedupe webhook gateway =====
DO $$
BEGIN
  INSERT INTO webhook_events (provider, provider_event_id, signature_valid, raw_payload)
  VALUES ('mockpay', 'EVT-1', true, '{}'::jsonb);
  RAISE NOTICE 'PASS  webhook: event pertama tersimpan';
END
$$;

SELECT pg_temp.expect_fail('webhook: event_id yang sama ditolak (idempotency)',
  $q$ INSERT INTO webhook_events (provider, provider_event_id, signature_valid, raw_payload)
      VALUES ('mockpay', 'EVT-1', true, '{}'::jsonb) $q$);

-- ================================================== 8. alasan review ========
SELECT pg_temp.expect_fail('review: alasan < 10 karakter ditolak',
  $q$ INSERT INTO review_decisions (report_id, decision, reason, decided_by)
      VALUES ((SELECT v FROM t_ids WHERE k='report'), 'REJECTED', 'pendek',
              (SELECT v FROM t_ids WHERE k='user')) $q$);

SELECT pg_temp.expect_ok('review: alasan memadai diterima',
  $q$ INSERT INTO review_decisions (report_id, decision, reason, decided_by)
      VALUES ((SELECT v FROM t_ids WHERE k='report'), 'APPROVED',
              'Bukti dan dasar hukum sudah lengkap dan relevan.',
              (SELECT v FROM t_ids WHERE k='user')) $q$);

DO $$ BEGIN RAISE NOTICE '--- seluruh pemeriksaan integritas database lulus ---'; END $$;

ROLLBACK;
