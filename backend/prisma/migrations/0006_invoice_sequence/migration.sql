-- =============================================================================
-- 0006_invoice_sequence — penomoran invoice (BRD/SRS v1.1 §6.5)
--
-- "Nomor invoice unik dan berurutan". Nomor diambil dari sequence database,
-- bukan dari menghitung baris, sehingga tetap unik dan tidak melompat mundur
-- ketika beberapa instance API menerbitkan invoice bersamaan.
-- =============================================================================

CREATE SEQUENCE IF NOT EXISTS invoice_number_seq
  AS BIGINT
  START WITH 1
  INCREMENT BY 1
  NO MAXVALUE
  CACHE 1;

GRANT USAGE, SELECT ON SEQUENCE invoice_number_seq TO srs_app;
