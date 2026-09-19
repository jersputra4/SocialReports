-- =============================================================================
-- 0001_init — skema dasar Sistem Pelaporan Konten Media Sosial (BRD/SRS v1.1 §5)
-- =============================================================================

-- gen_random_uuid() tersedia sebagai fungsi inti sejak PostgreSQL 13.
-- btree_gist dipakai oleh exclusion constraint rentang tarif pajak (0003).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ------------------------------------------------------------------- enum ---
CREATE TYPE "UserStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED');

CREATE TYPE "ReportStatus" AS ENUM (
  'DRAFT', 'WAITING_PAYMENT', 'PAYMENT_REVIEW', 'PAYMENT_REJECTED', 'EXPIRED',
  'PAID', 'WAITING_REVIEW', 'APPROVED', 'REJECTED', 'NEEDS_REVISION',
  'SUBMITTED', 'PARTIALLY_COMPLETED', 'COMPLETED', 'FAILED', 'CANCELLED', 'ARCHIVED'
);

CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SETTLED', 'MANUAL_REVIEW', 'EXPIRED', 'FAILED');
CREATE TYPE "ReviewDecisionType" AS ENUM ('APPROVED', 'REJECTED', 'NEEDS_REVISION');
CREATE TYPE "ConsentDocumentType" AS ENUM ('TERMS', 'PRIVACY', 'NO_REFUND');
CREATE TYPE "ProofType" AS ENUM ('POST_REPORTED', 'ACCOUNT_REPORTED', 'OTHER');
CREATE TYPE "ScanStatus" AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'ERROR');
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'DEAD');
CREATE TYPE "FetchStatus" AS ENUM ('OK', 'PARTIAL', 'FAILED', 'MANUAL');
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL_USER', 'N8N');
CREATE TYPE "NotificationResult" AS ENUM ('SUCCESS', 'FAILURE');

-- ------------------------------------------------------------------- auth ---
CREATE TABLE "roles" (
  "role_id"     UUID NOT NULL DEFAULT gen_random_uuid(),
  "code"        VARCHAR(64) NOT NULL,
  "name"        VARCHAR(128) NOT NULL,
  "description" VARCHAR(512),
  "is_staff"    BOOLEAN NOT NULL DEFAULT false,
  "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "roles_pkey" PRIMARY KEY ("role_id")
);
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

CREATE TABLE "permissions" (
  "permission_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code"          VARCHAR(64) NOT NULL,
  "description"   VARCHAR(512) NOT NULL,
  CONSTRAINT "permissions_pkey" PRIMARY KEY ("permission_id")
);
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

CREATE TABLE "role_permissions" (
  "role_id"       UUID NOT NULL,
  "permission_id" UUID NOT NULL,
  CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id", "permission_id")
);

CREATE TABLE "users" (
  "user_id"              UUID NOT NULL DEFAULT gen_random_uuid(),
  "email"                VARCHAR(320) NOT NULL,
  "full_name"            VARCHAR(160) NOT NULL,
  "phone"                VARCHAR(32),
  "password_hash"        VARCHAR(255) NOT NULL,
  "role_id"              UUID NOT NULL,
  "status"               "UserStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
  "email_verified_at"    TIMESTAMPTZ(6),
  "mfa_enabled"          BOOLEAN NOT NULL DEFAULT false,
  "must_change_password" BOOLEAN NOT NULL DEFAULT false,
  "failed_login_count"   INTEGER NOT NULL DEFAULT 0,
  "lockout_level"        INTEGER NOT NULL DEFAULT 0,
  "locked_until"         TIMESTAMPTZ(6),
  "last_login_at"        TIMESTAMPTZ(6),
  "password_changed_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "users_pkey" PRIMARY KEY ("user_id")
);
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE INDEX "users_status_idx" ON "users"("status");
CREATE INDEX "users_role_id_idx" ON "users"("role_id");

CREATE TABLE "user_sessions" (
  "session_id"          UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id"             UUID NOT NULL,
  "token_hash"          VARCHAR(64) NOT NULL,
  "csrf_token"          VARCHAR(64) NOT NULL,
  "ip_address"          VARCHAR(64),
  "user_agent"          VARCHAR(512),
  "mfa_verified_at"     TIMESTAMPTZ(6),
  "last_seen_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "idle_expires_at"     TIMESTAMPTZ(6) NOT NULL,
  "absolute_expires_at" TIMESTAMPTZ(6) NOT NULL,
  "revoked_at"          TIMESTAMPTZ(6),
  "revoked_reason"      VARCHAR(128),
  "created_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("session_id")
);
CREATE UNIQUE INDEX "user_sessions_token_hash_key" ON "user_sessions"("token_hash");
CREATE INDEX "user_sessions_user_id_idx" ON "user_sessions"("user_id");
CREATE INDEX "user_sessions_idle_expires_at_idx" ON "user_sessions"("idle_expires_at");

CREATE TABLE "password_resets" (
  "reset_id"   UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id"    UUID NOT NULL,
  "token_hash" VARCHAR(64) NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "used_at"    TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "password_resets_pkey" PRIMARY KEY ("reset_id")
);
CREATE UNIQUE INDEX "password_resets_token_hash_key" ON "password_resets"("token_hash");
CREATE INDEX "password_resets_user_id_idx" ON "password_resets"("user_id");

CREATE TABLE "email_verifications" (
  "verification_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id"         UUID NOT NULL,
  "token_hash"      VARCHAR(64) NOT NULL,
  "expires_at"      TIMESTAMPTZ(6) NOT NULL,
  "used_at"         TIMESTAMPTZ(6),
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_verifications_pkey" PRIMARY KEY ("verification_id")
);
CREATE UNIQUE INDEX "email_verifications_token_hash_key" ON "email_verifications"("token_hash");
CREATE INDEX "email_verifications_user_id_idx" ON "email_verifications"("user_id");

CREATE TABLE "mfa_challenges" (
  "challenge_id"    UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id"         UUID NOT NULL,
  "otp_hash"        VARCHAR(64) NOT NULL,
  "purpose"         VARCHAR(16) NOT NULL DEFAULT 'LOGIN',
  "expires_at"      TIMESTAMPTZ(6) NOT NULL,
  "attempts"        INTEGER NOT NULL DEFAULT 0,
  "used_at"         TIMESTAMPTZ(6),
  "session_binding" VARCHAR(64) NOT NULL,
  "ip_address"      VARCHAR(64),
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mfa_challenges_pkey" PRIMARY KEY ("challenge_id")
);
CREATE INDEX "mfa_challenges_user_id_created_at_idx" ON "mfa_challenges"("user_id", "created_at");

CREATE TABLE "user_consents" (
  "consent_id"       UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id"          UUID NOT NULL,
  "document_type"    "ConsentDocumentType" NOT NULL,
  "document_version" VARCHAR(32) NOT NULL,
  "accepted_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ip_address"       VARCHAR(64),
  "report_id"        UUID,
  CONSTRAINT "user_consents_pkey" PRIMARY KEY ("consent_id")
);
CREATE INDEX "user_consents_user_id_document_type_idx" ON "user_consents"("user_id", "document_type");
CREATE INDEX "user_consents_report_id_idx" ON "user_consents"("report_id");

-- ----------------------------------------------------------------- master ---
CREATE TABLE "social_platforms" (
  "platform_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code"        VARCHAR(32) NOT NULL,
  "name"        VARCHAR(64) NOT NULL,
  "domains"     VARCHAR(128)[] NOT NULL,
  "report_url"  VARCHAR(512),
  "active"      BOOLEAN NOT NULL DEFAULT true,
  "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "social_platforms_pkey" PRIMARY KEY ("platform_id")
);
CREATE UNIQUE INDEX "social_platforms_code_key" ON "social_platforms"("code");

CREATE TABLE "platform_policies" (
  "policy_id"   UUID NOT NULL DEFAULT gen_random_uuid(),
  "platform_id" UUID NOT NULL,
  "code"        VARCHAR(64) NOT NULL,
  "name"        VARCHAR(256) NOT NULL,
  "category"    VARCHAR(128),
  "archived_at" TIMESTAMPTZ(6),
  "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_policies_pkey" PRIMARY KEY ("policy_id")
);
CREATE UNIQUE INDEX "platform_policies_platform_id_code_key" ON "platform_policies"("platform_id", "code");

CREATE TABLE "platform_policy_versions" (
  "policy_version_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "policy_id"         UUID NOT NULL,
  "version"           VARCHAR(32) NOT NULL,
  "text"              TEXT NOT NULL,
  "source_url"        VARCHAR(512),
  "effective_from"    TIMESTAMPTZ(6) NOT NULL,
  "effective_to"      TIMESTAMPTZ(6),
  "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_policy_versions_pkey" PRIMARY KEY ("policy_version_id")
);
CREATE UNIQUE INDEX "platform_policy_versions_policy_id_version_key" ON "platform_policy_versions"("policy_id", "version");

CREATE TABLE "laws" (
  "law_id"      UUID NOT NULL DEFAULT gen_random_uuid(),
  "code"        VARCHAR(64) NOT NULL,
  "name"        VARCHAR(256) NOT NULL,
  "short_name"  VARCHAR(128),
  "archived_at" TIMESTAMPTZ(6),
  "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "laws_pkey" PRIMARY KEY ("law_id")
);
CREATE UNIQUE INDEX "laws_code_key" ON "laws"("code");

CREATE TABLE "legal_versions" (
  "legal_version_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "law_id"           UUID NOT NULL,
  "version"          VARCHAR(64) NOT NULL,
  "effective_from"   TIMESTAMPTZ(6) NOT NULL,
  "effective_to"     TIMESTAMPTZ(6),
  "created_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "legal_versions_pkey" PRIMARY KEY ("legal_version_id")
);
CREATE UNIQUE INDEX "legal_versions_law_id_version_key" ON "legal_versions"("law_id", "version");

CREATE TABLE "legal_articles" (
  "article_id"       UUID NOT NULL DEFAULT gen_random_uuid(),
  "legal_version_id" UUID NOT NULL,
  "number"           VARCHAR(32) NOT NULL,
  "title"            VARCHAR(256),
  "created_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "legal_articles_pkey" PRIMARY KEY ("article_id")
);
CREATE UNIQUE INDEX "legal_articles_legal_version_id_number_key" ON "legal_articles"("legal_version_id", "number");

CREATE TABLE "legal_paragraphs" (
  "paragraph_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "article_id"   UUID NOT NULL,
  "number"       VARCHAR(32) NOT NULL,
  "text"         TEXT NOT NULL,
  "explanation"  TEXT,
  "created_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "legal_paragraphs_pkey" PRIMARY KEY ("paragraph_id")
);
CREATE UNIQUE INDEX "legal_paragraphs_article_id_number_key" ON "legal_paragraphs"("article_id", "number");

CREATE TABLE "legal_amendments" (
  "amendment_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "law_id"       UUID NOT NULL,
  "title"        VARCHAR(256) NOT NULL,
  "description"  TEXT,
  "issued_at"    TIMESTAMPTZ(6) NOT NULL,
  "created_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "legal_amendments_pkey" PRIMARY KEY ("amendment_id")
);

CREATE TABLE "action_types" (
  "action_type_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code"           VARCHAR(32) NOT NULL,
  "name"           VARCHAR(128) NOT NULL,
  "active"         BOOLEAN NOT NULL DEFAULT true,
  "created_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "action_types_pkey" PRIMARY KEY ("action_type_id")
);
CREATE UNIQUE INDEX "action_types_code_key" ON "action_types"("code");

-- ---------------------------------------------------------------- pricing ---
CREATE TABLE "packages" (
  "package_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code"       VARCHAR(32) NOT NULL,
  "quantity"   INTEGER NOT NULL,
  "active"     BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "packages_pkey" PRIMARY KEY ("package_id")
);
CREATE UNIQUE INDEX "packages_code_key" ON "packages"("code");

CREATE TABLE "pricing_config" (
  "pricing_id"     UUID NOT NULL DEFAULT gen_random_uuid(),
  "unit_price"     BIGINT NOT NULL,
  "effective_from" TIMESTAMPTZ(6) NOT NULL,
  "effective_to"   TIMESTAMPTZ(6),
  "created_by"     UUID,
  "created_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pricing_config_pkey" PRIMARY KEY ("pricing_id")
);
CREATE INDEX "pricing_config_effective_from_idx" ON "pricing_config"("effective_from");

CREATE TABLE "tax_config" (
  "tax_id"         UUID NOT NULL DEFAULT gen_random_uuid(),
  "tax_name"       VARCHAR(32) NOT NULL DEFAULT 'PPN',
  "rate_bp"        INTEGER NOT NULL,
  "effective_from" TIMESTAMPTZ(6) NOT NULL,
  "effective_to"   TIMESTAMPTZ(6),
  "created_by"     UUID,
  "created_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tax_config_pkey" PRIMARY KEY ("tax_id")
);
CREATE INDEX "tax_config_effective_from_idx" ON "tax_config"("effective_from");

CREATE TABLE "payment_methods" (
  "payment_method_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code"              VARCHAR(32) NOT NULL,
  "name"              VARCHAR(128) NOT NULL,
  "group"             VARCHAR(32) NOT NULL,
  "active"            BOOLEAN NOT NULL DEFAULT true,
  "sort_order"        INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("payment_method_id")
);
CREATE UNIQUE INDEX "payment_methods_code_key" ON "payment_methods"("code");

-- ----------------------------------------------------------------- report ---
CREATE TABLE "target_snapshots" (
  "target_snapshot_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "original_url"       VARCHAR(2048) NOT NULL,
  "canonical_url"      VARCHAR(2048),
  "platform_id"        UUID,
  "metadata_json"      JSONB,
  "fetched_at"         TIMESTAMPTZ(6),
  "fetch_status"       "FetchStatus" NOT NULL DEFAULT 'MANUAL',
  "fetch_error"        VARCHAR(512),
  "created_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "target_snapshots_pkey" PRIMARY KEY ("target_snapshot_id")
);

CREATE TABLE "reports" (
  "report_id"                 UUID NOT NULL DEFAULT gen_random_uuid(),
  "report_code"               VARCHAR(20) NOT NULL,
  "user_id"                   UUID NOT NULL,
  "status"                    "ReportStatus" NOT NULL DEFAULT 'DRAFT',
  "action_type_id"            UUID NOT NULL,
  "package_id"                UUID NOT NULL,
  "package_quantity"          INTEGER NOT NULL,
  "target_snapshot_id"        UUID,
  "retry_count"               INTEGER NOT NULL DEFAULT 0,
  "description"               TEXT,
  "unit_price_snapshot"       BIGINT,
  "subtotal_snapshot"         BIGINT,
  "tax_rate_bp_snapshot"      INTEGER,
  "tax_amount_snapshot"       BIGINT,
  "total_amount_snapshot"     BIGINT,
  "platform_name_snapshot"    VARCHAR(64),
  "policy_name_snapshot"      VARCHAR(256),
  "policy_version_snapshot"   VARCHAR(32),
  "policy_text_snapshot"      TEXT,
  "other_policy_reason"       TEXT,
  "law_name_snapshot"         VARCHAR(256),
  "law_version_snapshot"      VARCHAR(64),
  "article_number_snapshot"   VARCHAR(32),
  "paragraph_number_snapshot" VARCHAR(32),
  "text_snapshot"             TEXT,
  "explanation_snapshot"      TEXT,
  "other_legal_reason"        TEXT,
  "snapshot_sealed_at"        TIMESTAMPTZ(6),
  "submitted_at"              TIMESTAMPTZ(6),
  "completed_at"              TIMESTAMPTZ(6),
  "expired_at"                TIMESTAMPTZ(6),
  "archived_at"               TIMESTAMPTZ(6),
  "created_at"                TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"                TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reports_pkey" PRIMARY KEY ("report_id")
);
CREATE UNIQUE INDEX "reports_report_code_key" ON "reports"("report_code");
CREATE INDEX "reports_user_id_status_idx" ON "reports"("user_id", "status");
CREATE INDEX "reports_status_created_at_idx" ON "reports"("status", "created_at");

CREATE TABLE "report_status_history" (
  "history_id"  UUID NOT NULL DEFAULT gen_random_uuid(),
  "report_id"   UUID NOT NULL,
  "from_status" "ReportStatus",
  "to_status"   "ReportStatus" NOT NULL,
  "actor_id"    UUID,
  "actor_role"  VARCHAR(64),
  "reason"      TEXT,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "report_status_history_pkey" PRIMARY KEY ("history_id")
);
CREATE INDEX "report_status_history_report_id_occurred_at_idx" ON "report_status_history"("report_id", "occurred_at");

CREATE TABLE "report_policies" (
  "report_policy_id"  UUID NOT NULL DEFAULT gen_random_uuid(),
  "report_id"         UUID NOT NULL,
  "policy_id"         UUID,
  "policy_version_id" UUID,
  "name_snapshot"     VARCHAR(256) NOT NULL,
  "version_snapshot"  VARCHAR(32),
  "text_snapshot"     TEXT,
  "other_reason"      TEXT,
  "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "report_policies_pkey" PRIMARY KEY ("report_policy_id")
);
CREATE INDEX "report_policies_report_id_idx" ON "report_policies"("report_id");

CREATE TABLE "report_legal_basis" (
  "report_legal_id"           UUID NOT NULL DEFAULT gen_random_uuid(),
  "report_id"                 UUID NOT NULL,
  "paragraph_id"              UUID,
  "law_name_snapshot"         VARCHAR(256) NOT NULL,
  "law_version_snapshot"      VARCHAR(64),
  "article_number_snapshot"   VARCHAR(32),
  "paragraph_number_snapshot" VARCHAR(32),
  "text_snapshot"             TEXT,
  "explanation_snapshot"      TEXT,
  "other_reason"              TEXT,
  "created_at"                TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "report_legal_basis_pkey" PRIMARY KEY ("report_legal_id")
);
CREATE INDEX "report_legal_basis_report_id_idx" ON "report_legal_basis"("report_id");

CREATE TABLE "review_decisions" (
  "decision_id"    UUID NOT NULL DEFAULT gen_random_uuid(),
  "report_id"      UUID NOT NULL,
  "decision"       "ReviewDecisionType" NOT NULL,
  "reason"         TEXT NOT NULL,
  "checklist_json" JSONB,
  "decided_by"     UUID NOT NULL,
  "decided_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "review_decisions_pkey" PRIMARY KEY ("decision_id")
);
CREATE INDEX "review_decisions_report_id_idx" ON "review_decisions"("report_id");

CREATE TABLE "complaint_submissions" (
  "submission_id"      UUID NOT NULL DEFAULT gen_random_uuid(),
  "report_id"          UUID NOT NULL,
  "channel"            VARCHAR(64) NOT NULL,
  "submitted_by"       UUID NOT NULL,
  "submitted_at"       TIMESTAMPTZ(6) NOT NULL,
  "external_reference" VARCHAR(256),
  "notes"              TEXT,
  "created_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "complaint_submissions_pkey" PRIMARY KEY ("submission_id")
);
CREATE INDEX "complaint_submissions_report_id_idx" ON "complaint_submissions"("report_id");

-- --------------------------------------------------------------- evidence ---
CREATE TABLE "evidences" (
  "evidence_id"  UUID NOT NULL DEFAULT gen_random_uuid(),
  "report_id"    UUID NOT NULL,
  "file_name"    VARCHAR(256) NOT NULL,
  "file_type"    VARCHAR(64) NOT NULL,
  "file_size"    INTEGER NOT NULL,
  "file_hash"    VARCHAR(64) NOT NULL,
  "storage_path" VARCHAR(512) NOT NULL,
  "caption"      VARCHAR(500),
  "scan_status"  "ScanStatus" NOT NULL DEFAULT 'PENDING',
  "scan_message" VARCHAR(256),
  "scanned_at"   TIMESTAMPTZ(6),
  "created_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "evidences_pkey" PRIMARY KEY ("evidence_id")
);
CREATE INDEX "evidences_report_id_idx" ON "evidences"("report_id");

CREATE TABLE "report_documents" (
  "document_id"     UUID NOT NULL DEFAULT gen_random_uuid(),
  "report_id"       UUID NOT NULL,
  "document_type"   VARCHAR(32) NOT NULL,
  "version"         INTEGER NOT NULL,
  "file_name"       VARCHAR(256) NOT NULL,
  "file_hash"       VARCHAR(64) NOT NULL,
  "file_size"       INTEGER NOT NULL,
  "storage_path"    VARCHAR(512) NOT NULL,
  "includes_proofs" BOOLEAN NOT NULL DEFAULT false,
  "generated_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "report_documents_pkey" PRIMARY KEY ("document_id")
);
CREATE UNIQUE INDEX "report_documents_report_id_document_type_version_key" ON "report_documents"("report_id", "document_type", "version");
CREATE INDEX "report_documents_report_id_idx" ON "report_documents"("report_id");

CREATE TABLE "report_completion_proofs" (
  "proof_id"        UUID NOT NULL DEFAULT gen_random_uuid(),
  "report_id"       UUID NOT NULL,
  "uploaded_by"     UUID NOT NULL,
  "proof_type"      "ProofType" NOT NULL,
  "reported_at"     TIMESTAMPTZ(6) NOT NULL,
  "caption"         VARCHAR(500),
  "units_reported"  INTEGER,
  "file_name"       VARCHAR(256) NOT NULL,
  "file_type"       VARCHAR(64) NOT NULL,
  "file_size"       INTEGER NOT NULL,
  "file_hash"       VARCHAR(64) NOT NULL,
  "storage_path"    VARCHAR(512) NOT NULL,
  "scan_status"     "ScanStatus" NOT NULL DEFAULT 'PENDING',
  "scan_message"    VARCHAR(256),
  "visible_to_user" BOOLEAN NOT NULL DEFAULT true,
  "voided_at"       TIMESTAMPTZ(6),
  "voided_by"       UUID,
  "void_reason"     TEXT,
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "report_completion_proofs_pkey" PRIMARY KEY ("proof_id")
);
CREATE INDEX "report_completion_proofs_report_id_voided_at_idx" ON "report_completion_proofs"("report_id", "voided_at");

-- ---------------------------------------------------------------- payment ---
CREATE TABLE "invoices" (
  "invoice_id"     UUID NOT NULL DEFAULT gen_random_uuid(),
  "invoice_number" VARCHAR(32) NOT NULL,
  "report_id"      UUID NOT NULL,
  "subtotal"       BIGINT NOT NULL,
  "tax_rate_bp"    INTEGER NOT NULL,
  "tax_amount"     BIGINT NOT NULL,
  "total"          BIGINT NOT NULL,
  "issued_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "document_id"    UUID,
  CONSTRAINT "invoices_pkey" PRIMARY KEY ("invoice_id")
);
CREATE UNIQUE INDEX "invoices_invoice_number_key" ON "invoices"("invoice_number");
CREATE INDEX "invoices_report_id_idx" ON "invoices"("report_id");

CREATE TABLE "payments" (
  "payment_id"       UUID NOT NULL DEFAULT gen_random_uuid(),
  "report_id"        UUID NOT NULL,
  "invoice_id"       UUID,
  "provider"         VARCHAR(64) NOT NULL,
  "gateway_order_id" VARCHAR(128) NOT NULL,
  "payment_method"   VARCHAR(64),
  "subtotal"         BIGINT NOT NULL,
  "tax_amount"       BIGINT NOT NULL,
  "total_amount"     BIGINT NOT NULL,
  "paid_amount"      BIGINT NOT NULL DEFAULT 0,
  "overpaid_amount"  BIGINT NOT NULL DEFAULT 0,
  "status"           "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  "checkout_url"     VARCHAR(512),
  "expires_at"       TIMESTAMPTZ(6) NOT NULL,
  "paid_at"          TIMESTAMPTZ(6),
  "created_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payments_pkey" PRIMARY KEY ("payment_id")
);
CREATE UNIQUE INDEX "payments_gateway_order_id_key" ON "payments"("gateway_order_id");
CREATE INDEX "payments_report_id_idx" ON "payments"("report_id");
CREATE INDEX "payments_status_expires_at_idx" ON "payments"("status", "expires_at");

CREATE TABLE "payment_transactions" (
  "transaction_id"    UUID NOT NULL DEFAULT gen_random_uuid(),
  "payment_id"        UUID NOT NULL,
  "provider_event_id" VARCHAR(128) NOT NULL,
  "raw_payload"       JSONB NOT NULL,
  "status"            VARCHAR(32) NOT NULL,
  "amount"            BIGINT NOT NULL,
  "received_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_transactions_pkey" PRIMARY KEY ("transaction_id")
);
CREATE INDEX "payment_transactions_payment_id_idx" ON "payment_transactions"("payment_id");

CREATE TABLE "payment_verifications" (
  "verification_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "payment_id"      UUID NOT NULL,
  "reason"          TEXT NOT NULL,
  "decision"        VARCHAR(32) NOT NULL,
  "verified_by"     UUID NOT NULL,
  "verified_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_verifications_pkey" PRIMARY KEY ("verification_id")
);
CREATE INDEX "payment_verifications_payment_id_idx" ON "payment_verifications"("payment_id");

CREATE TABLE "payment_reconciliations" (
  "reconciliation_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "run_date"          DATE NOT NULL,
  "payment_id"        UUID,
  "gateway_status"    VARCHAR(32),
  "db_status"         VARCHAR(32),
  "difference"        BIGINT NOT NULL DEFAULT 0,
  "note"              TEXT,
  "resolved_by"       UUID,
  "resolved_at"       TIMESTAMPTZ(6),
  "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_reconciliations_pkey" PRIMARY KEY ("reconciliation_id")
);
CREATE INDEX "payment_reconciliations_run_date_idx" ON "payment_reconciliations"("run_date");

CREATE TABLE "webhook_events" (
  "webhook_event_id"  UUID NOT NULL DEFAULT gen_random_uuid(),
  "provider"          VARCHAR(64) NOT NULL,
  "provider_event_id" VARCHAR(128) NOT NULL,
  "signature_valid"   BOOLEAN NOT NULL,
  "raw_payload"       JSONB NOT NULL,
  "received_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at"      TIMESTAMPTZ(6),
  "process_error"     VARCHAR(512),
  CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("webhook_event_id")
);
CREATE UNIQUE INDEX "webhook_events_provider_provider_event_id_key" ON "webhook_events"("provider", "provider_event_id");

-- ------------------------------------------------------------- notifikasi ---
CREATE TABLE "outbox_events" (
  "event_id"        UUID NOT NULL DEFAULT gen_random_uuid(),
  "event_type"      VARCHAR(64) NOT NULL,
  "report_id"       UUID,
  "payload_json"    JSONB NOT NULL,
  "status"          "OutboxStatus" NOT NULL DEFAULT 'PENDING',
  "attempts"        INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_error"      VARCHAR(1024),
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dispatched_at"   TIMESTAMPTZ(6),
  CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("event_id")
);
CREATE INDEX "outbox_events_status_next_attempt_at_idx" ON "outbox_events"("status", "next_attempt_at");

CREATE TABLE "notification_logs" (
  "log_id"      UUID NOT NULL DEFAULT gen_random_uuid(),
  "event_id"    UUID,
  "channel"     "NotificationChannel" NOT NULL,
  "target"      VARCHAR(256),
  "result"      "NotificationResult" NOT NULL,
  "http_status" INTEGER,
  "detail"      VARCHAR(1024),
  "attempt"     INTEGER NOT NULL DEFAULT 1,
  "duration_ms" INTEGER,
  "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("log_id")
);
CREATE INDEX "notification_logs_event_id_idx" ON "notification_logs"("event_id");

CREATE TABLE "idempotency_keys" (
  "key"          VARCHAR(128) NOT NULL,
  "scope"        VARCHAR(64) NOT NULL,
  "request_hash" VARCHAR(64) NOT NULL,
  "response_ref" VARCHAR(256),
  "created_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "dev_mailbox" (
  "mail_id"    UUID NOT NULL DEFAULT gen_random_uuid(),
  "to_address" VARCHAR(320) NOT NULL,
  "subject"    VARCHAR(256) NOT NULL,
  "body_text"  TEXT NOT NULL,
  "body_html"  TEXT,
  "highlight"  VARCHAR(128),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "dev_mailbox_pkey" PRIMARY KEY ("mail_id")
);
CREATE INDEX "dev_mailbox_to_address_created_at_idx" ON "dev_mailbox"("to_address", "created_at");

-- ------------------------------------------------------------------ audit ---
CREATE TABLE "audit_logs" (
  "audit_id"    UUID NOT NULL DEFAULT gen_random_uuid(),
  "seq"         BIGSERIAL NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actor_id"    UUID,
  "actor_role"  VARCHAR(64),
  "ip_address"  VARCHAR(64),
  "user_agent"  VARCHAR(512),
  "action"      VARCHAR(64) NOT NULL,
  "entity_type" VARCHAR(64),
  "entity_id"   VARCHAR(64),
  "before_json" JSONB,
  "after_json"  JSONB,
  "request_id"  VARCHAR(64),
  "prev_hash"   VARCHAR(64) NOT NULL,
  "entry_hash"  VARCHAR(64) NOT NULL,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("audit_id")
);
CREATE UNIQUE INDEX "audit_logs_seq_key" ON "audit_logs"("seq");
CREATE INDEX "audit_logs_occurred_at_idx" ON "audit_logs"("occurred_at");
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

CREATE TABLE "audit_checkpoints" (
  "checkpoint_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "for_date"      DATE NOT NULL,
  "last_seq"      BIGINT NOT NULL,
  "last_hash"     VARCHAR(64) NOT NULL,
  "verified"      BOOLEAN NOT NULL DEFAULT false,
  "storage_path"  VARCHAR(512),
  "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_checkpoints_pkey" PRIMARY KEY ("checkpoint_id")
);
CREATE UNIQUE INDEX "audit_checkpoints_for_date_key" ON "audit_checkpoints"("for_date");

-- -------------------------------------------------------------- foreign key --
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey"
  FOREIGN KEY ("role_id") REFERENCES "roles"("role_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey"
  FOREIGN KEY ("permission_id") REFERENCES "permissions"("permission_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "users" ADD CONSTRAINT "users_role_id_fkey"
  FOREIGN KEY ("role_id") REFERENCES "roles"("role_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "email_verifications" ADD CONSTRAINT "email_verifications_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mfa_challenges" ADD CONSTRAINT "mfa_challenges_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_consents" ADD CONSTRAINT "user_consents_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_consents" ADD CONSTRAINT "user_consents_report_id_fkey"
  FOREIGN KEY ("report_id") REFERENCES "reports"("report_id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "platform_policies" ADD CONSTRAINT "platform_policies_platform_id_fkey"
  FOREIGN KEY ("platform_id") REFERENCES "social_platforms"("platform_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "platform_policy_versions" ADD CONSTRAINT "platform_policy_versions_policy_id_fkey"
  FOREIGN KEY ("policy_id") REFERENCES "platform_policies"("policy_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "legal_versions" ADD CONSTRAINT "legal_versions_law_id_fkey"
  FOREIGN KEY ("law_id") REFERENCES "laws"("law_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "legal_articles" ADD CONSTRAINT "legal_articles_legal_version_id_fkey"
  FOREIGN KEY ("legal_version_id") REFERENCES "legal_versions"("legal_version_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "legal_paragraphs" ADD CONSTRAINT "legal_paragraphs_article_id_fkey"
  FOREIGN KEY ("article_id") REFERENCES "legal_articles"("article_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "legal_amendments" ADD CONSTRAINT "legal_amendments_law_id_fkey"
  FOREIGN KEY ("law_id") REFERENCES "laws"("law_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "target_snapshots" ADD CONSTRAINT "target_snapshots_platform_id_fkey"
  FOREIGN KEY ("platform_id") REFERENCES "social_platforms"("platform_id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "reports" ADD CONSTRAINT "reports_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reports" ADD CONSTRAINT "reports_action_type_id_fkey"
  FOREIGN KEY ("action_type_id") REFERENCES "action_types"("action_type_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reports" ADD CONSTRAINT "reports_package_id_fkey"
  FOREIGN KEY ("package_id") REFERENCES "packages"("package_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reports" ADD CONSTRAINT "reports_target_snapshot_id_fkey"
  FOREIGN KEY ("target_snapshot_id") REFERENCES "target_snapshots"("target_snapshot_id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "report_status_history" ADD CONSTRAINT "report_status_history_report_id_fkey"
  FOREIGN KEY ("report_id") REFERENCES "reports"("report_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "report_policies" ADD CONSTRAINT "report_policies_report_id_fkey"
  FOREIGN KEY ("report_id") REFERENCES "reports"("report_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "report_policies" ADD CONSTRAINT "report_policies_policy_id_fkey"
  FOREIGN KEY ("policy_id") REFERENCES "platform_policies"("policy_id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "report_policies" ADD CONSTRAINT "report_policies_policy_version_id_fkey"
  FOREIGN KEY ("policy_version_id") REFERENCES "platform_policy_versions"("policy_version_id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "report_legal_basis" ADD CONSTRAINT "report_legal_basis_report_id_fkey"
  FOREIGN KEY ("report_id") REFERENCES "reports"("report_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "report_legal_basis" ADD CONSTRAINT "report_legal_basis_paragraph_id_fkey"
  FOREIGN KEY ("paragraph_id") REFERENCES "legal_paragraphs"("paragraph_id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_report_id_fkey"
  FOREIGN KEY ("report_id") REFERENCES "reports"("report_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_decided_by_fkey"
  FOREIGN KEY ("decided_by") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "complaint_submissions" ADD CONSTRAINT "complaint_submissions_report_id_fkey"
  FOREIGN KEY ("report_id") REFERENCES "reports"("report_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "complaint_submissions" ADD CONSTRAINT "complaint_submissions_submitted_by_fkey"
  FOREIGN KEY ("submitted_by") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "evidences" ADD CONSTRAINT "evidences_report_id_fkey"
  FOREIGN KEY ("report_id") REFERENCES "reports"("report_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "report_documents" ADD CONSTRAINT "report_documents_report_id_fkey"
  FOREIGN KEY ("report_id") REFERENCES "reports"("report_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "report_completion_proofs" ADD CONSTRAINT "report_completion_proofs_report_id_fkey"
  FOREIGN KEY ("report_id") REFERENCES "reports"("report_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "report_completion_proofs" ADD CONSTRAINT "report_completion_proofs_uploaded_by_fkey"
  FOREIGN KEY ("uploaded_by") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "report_completion_proofs" ADD CONSTRAINT "report_completion_proofs_voided_by_fkey"
  FOREIGN KEY ("voided_by") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_report_id_fkey"
  FOREIGN KEY ("report_id") REFERENCES "reports"("report_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_report_id_fkey"
  FOREIGN KEY ("report_id") REFERENCES "reports"("report_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_payment_id_fkey"
  FOREIGN KEY ("payment_id") REFERENCES "payments"("payment_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_verifications" ADD CONSTRAINT "payment_verifications_payment_id_fkey"
  FOREIGN KEY ("payment_id") REFERENCES "payments"("payment_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_reconciliations" ADD CONSTRAINT "payment_reconciliations_payment_id_fkey"
  FOREIGN KEY ("payment_id") REFERENCES "payments"("payment_id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_report_id_fkey"
  FOREIGN KEY ("report_id") REFERENCES "reports"("report_id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "outbox_events"("event_id") ON DELETE SET NULL ON UPDATE CASCADE;
