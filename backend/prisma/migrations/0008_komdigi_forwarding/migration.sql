-- 0008_komdigi_forwarding: pelacakan pengiriman berkas ke Komdigi.
CREATE TYPE "ComplaintDeliveryStatus" AS ENUM ('PENDING','SENT','FAILED','DEAD');

ALTER TABLE "complaint_submissions"
  ADD COLUMN "delivery_status" "ComplaintDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "message_id" VARCHAR(512),
  ADD COLUMN "payload_hash" VARCHAR(64),
  ADD COLUMN "attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_attempt_at" TIMESTAMPTZ(6),
  ADD COLUMN "last_error" VARCHAR(512);

-- Baris lama berasal dari pencatatan manual admin: pengirimannya sudah terjadi.
UPDATE "complaint_submissions" SET "delivery_status" = 'SENT';

-- Parsial, bukan unique penuh: percobaan ulang setelah FAILED tetap sah.
CREATE UNIQUE INDEX "complaint_submissions_komdigi_live_uniq"
  ON "complaint_submissions" ("report_id")
  WHERE "channel" = 'KOMDIGI_EMAIL' AND "delivery_status" IN ('PENDING','SENT');

CREATE INDEX "complaint_submissions_delivery_idx"
  ON "complaint_submissions" ("delivery_status", "last_attempt_at");
