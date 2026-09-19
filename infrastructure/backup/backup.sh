#!/usr/bin/env bash
#
# Backup harian — mendukung NFR-07 (RTO <= 4 jam, RPO database <= 15 menit).
#
#   ./infrastructure/backup/backup.sh /path/tujuan
#
# Yang dicadangkan:
#   1. dump logis PostgreSQL (pg_dump format custom, dapat di-restore selektif)
#   2. isi bucket object storage (evidence, bukti pengerjaan, PDF, checkpoint audit)
#   3. checkpoint rantai hash audit terakhir, sebagai pembanding setelah restore
#
# Yang TIDAK dilakukan skrip ini, dan harus disiapkan terpisah:
#   - WAL archiving berkelanjutan untuk PITR (RPO 15 menit tidak tercapai dengan
#     dump harian saja; compose sudah mengaktifkan wal_level=replica sebagai dasar)
#   - penyalinan ke lokasi terpisah secara geografis
#   - enkripsi arsip dengan kunci yang disimpan di luar mesin ini
#   - latihan restore triwulanan
#
set -euo pipefail

DEST="${1:-./backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${DEST}/${STAMP}"

PGUSER="${POSTGRES_USER:-srs}"
PGDB="${POSTGRES_DB:-social_report}"
BUCKET="${S3_BUCKET:-social-report}"
COMPOSE="${COMPOSE:-docker compose}"

mkdir -p "$OUT"
echo "Menulis backup ke ${OUT}"

# ---------------------------------------------------------------- database ---
echo "  · dump PostgreSQL"
$COMPOSE exec -T postgres pg_dump \
  --username="$PGUSER" \
  --dbname="$PGDB" \
  --format=custom \
  --compress=9 \
  > "${OUT}/database.dump"

# ------------------------------------------------------------ object storage --
echo "  · salinan object storage"
$COMPOSE exec -T minio sh -c "
  mc alias set backup http://localhost:9000 \$MINIO_ROOT_USER \$MINIO_ROOT_PASSWORD >/dev/null &&
  mc mirror --quiet backup/${BUCKET} /tmp/backup-${STAMP} >/dev/null &&
  tar -C /tmp -cz backup-${STAMP} &&
  rm -rf /tmp/backup-${STAMP}
" > "${OUT}/storage.tar.gz"

# ------------------------------------------------------- checkpoint audit ----
echo "  · checkpoint rantai hash audit"
$COMPOSE exec -T postgres psql \
  --username="$PGUSER" --dbname="$PGDB" --tuples-only --no-align \
  --command="SELECT json_build_object(
      'seq', seq,
      'entry_hash', entry_hash,
      'occurred_at', occurred_at
    ) FROM audit_logs ORDER BY seq DESC LIMIT 1;" \
  > "${OUT}/audit-checkpoint.json"

# --------------------------------------------------------------- manifest ----
{
  echo "stamp=${STAMP}"
  echo "database_bytes=$(stat -c%s "${OUT}/database.dump")"
  echo "storage_bytes=$(stat -c%s "${OUT}/storage.tar.gz")"
  echo "database_sha256=$(sha256sum "${OUT}/database.dump" | cut -d' ' -f1)"
  echo "storage_sha256=$(sha256sum "${OUT}/storage.tar.gz" | cut -d' ' -f1)"
} > "${OUT}/manifest.txt"

echo "Selesai."
echo
echo "Setelah restore, jalankan verifikasi berikut sebelum backup dianggap sah:"
echo "  docker compose exec api node dist/cli/verify-audit-chain.js"
echo "  bandingkan hash terakhirnya dengan audit-checkpoint.json di atas"
