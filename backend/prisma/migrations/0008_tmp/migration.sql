import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AuditAction } from '../common/audit/audit-actions';
import { OutboxEventType, OutboxService } from '../notifications/outbox.service';
import { ReportTransitionService } from '../reports/report-transition.service';

/**
 * Pencatatan pelaporan ke platform (BRD 7.2 baris 18, AC-24).
 *
 * Sistem ini tidak melapor ke platform secara otomatis. Admin melakukannya
 * lewat jalur resmi masing-masing platform, lalu mencatat kanal, waktu, dan
 * nomor acuan di sini. Tanpa catatan ini report tidak dapat berpindah ke
 * SUBMITTED — itulah yang membuat klaim "sudah dilaporkan" punya bukti.
 */
@Injectable()
export class ComplaintsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly transitions: ReportTransitionService,
  ) {}

  async submitToPlatform(input: {
    reportCode: string;
    channel: string;
    externalReference?: string;
    notes?: string;
    adminId: string;
    adminRole: string;
  }): Promise<{ reportCode: string; status: string }> {
    const report = await this.prisma.report.findUnique({
      where: { reportCode: input.reportCode },
    });
    if (!report) throw new NotFoundException('Report tidak ditemukan.');

    return this.prisma.$transaction(async (tx) => {
      await tx.complaintSubmission.create({
        data: {
          reportId: report.id,
          channel: input.channel,
          submittedBy: input.adminId,
          submittedAt: new Date(),
          externalReference: input.externalReference?.slice(0, 256),
          notes: input.notes,
          // Admin mencatat pelaporan yang sudah ia lakukan sendiri, jadi
          // pengirimannya selesai saat baris ini dibuat. Default kolom
          // (PENDING) berlaku untuk kiriman otomatis yang belum dikerjakan job.
          deliveryStatus: 'SENT',
          attemptCount: 1,
          lastAttemptAt: new Date(),
        },
      });

      await this.audit.record(
        {
          action: AuditAction.EXTERNAL_SUBMISSION,
          entityType: 'report',
          entityId: report.reportCode,
          actorId: input.adminId,
          actorRole: input.adminRole,
          after: {
            channel: input.channel,
            externalReference: input.externalReference ?? null,
          },
        },
        tx,
      );

      await this.outbox.enqueue(
        {
          eventType: OutboxEventType.COMPLAINT_SUBMITTED,
          reportId: report.id,
          reportCode: report.reportCode,
          status: report.status,
        },
        tx,
      );

      const updated = await this.transitions.transitionWithin(tx, {
        reportId: report.id,
        to: 'SUBMITTED',
        actor: 'ADMIN',
        actorId: input.adminId,
        actorRole: input.adminRole,
        extraGuards: ['COMPLAINT_SUBMISSION'],
      });

      return { reportCode: updated.reportCode, status: updated.status };
    });
  }

  async listForReport(reportCode: string) {
    const report = await this.prisma.report.findUnique({
      where: { reportCode },
      select: { id: true },
    });
    if (!report) throw new NotFoundException('Report tidak ditemukan.');

    return this.prisma.complaintSubmission.findMany({
      where: { reportId: report.id },
      orderBy: { submittedAt: 'desc' },
      include: { user: { select: { fullName: true } } },
    });
  }
}

// =============================================================================
// Sistem Pelaporan Konten Media Sosial — model data
// Mengacu BRD/SRS v1.1 bagian 5 (Model Data).
//
// Aturan umum:
//   - Semua primary key UUID v7 (RFC 9562) yang dihasilkan fungsi database
//     uuid_generate_v7() — lihat migrasi 0005. Nilainya terurut waktu sehingga
//     index tidak terfragmentasi, dan tetap tidak dapat ditebak.
//   - Uang disimpan sebagai BigInt dalam rupiah penuh (tanpa desimal).
//   - Seluruh kolom waktu memakai timestamptz.
//   - Nama tabel dan kolom di database mengikuti penamaan pada dokumen (@map).
// =============================================================================

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ============================================================ enum ============

enum UserStatus {
  PENDING_VERIFICATION
  ACTIVE
  SUSPENDED
}

/// Status report — BRD 7.1/7.2
enum ReportStatus {
  DRAFT
  WAITING_PAYMENT
  PAYMENT_REVIEW
  PAYMENT_REJECTED
  EXPIRED
  PAID
  WAITING_REVIEW
  APPROVED
  REJECTED
  NEEDS_REVISION
  SUBMITTED
  PARTIALLY_COMPLETED
  COMPLETED
  FAILED
  CANCELLED
  ARCHIVED
}

/// BRD 6.3 — tidak ada status refund apa pun.
enum PaymentStatus {
  PENDING
  SETTLED
  MANUAL_REVIEW
  EXPIRED
  FAILED
}

enum ReviewDecisionType {
  APPROVED
  REJECTED
  NEEDS_REVISION
}

enum ConsentDocumentType {
  TERMS
  PRIVACY
  NO_REFUND
}

enum ProofType {
  POST_REPORTED
  ACCOUNT_REPORTED
  OTHER
}

enum ScanStatus {
  PENDING
  CLEAN
  INFECTED
  ERROR
}

enum OutboxStatus {
  PENDING
  SENT
  FAILED
  DEAD
}

/// Status pengiriman berkas aduan ke kanal resmi (migrasi 0008).
enum ComplaintDeliveryStatus {
  PENDING
  SENT
  FAILED
  DEAD
}

enum FetchStatus {
  OK
  PARTIAL
  FAILED
  MANUAL
}

enum NotificationChannel {
  EMAIL_USER
  N8N
}

enum NotificationResult {
  SUCCESS
  FAILURE
}

// ============================================================ auth ============

model Role {
  id          String  @id @default(dbgenerated("uuid_generate_v7()")) @map("role_id") @db.Uuid
  code        String  @unique @db.VarChar(64)
  name        String  @db.VarChar(128)
  description String? @db.VarChar(512)
  /// Role internal (admin/reviewer/finance) memakai kebijakan password & MFA admin.
  isStaff     Boolean @default(false) @map("is_staff")
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  permissions RolePermission[]
  users       User[]

  @@map("roles")
}

model Permission {
  id          String  @id @default(dbgenerated("uuid_generate_v7()")) @map("permission_id") @db.Uuid
  /// mis. report.review, payment.verify, report.fulfill, audit.read, pricing.manage
  code        String  @unique @db.VarChar(64)
  description String  @db.VarChar(512)

  roles RolePermission[]

  @@map("permissions")
}

model RolePermission {
  roleId       String @map("role_id") @db.Uuid
  permissionId String @map("permission_id") @db.Uuid

  role       Role       @relation(fields: [roleId], references: [id], onDelete: Cascade)
  permission Permission @relation(fields: [permissionId], references: [id], onDelete: Cascade)

  @@id([roleId, permissionId])
  @@map("role_permissions")
}

model User {
  id               String     @id @default(dbgenerated("uuid_generate_v7()")) @map("user_id") @db.Uuid
  email            String     @unique @db.VarChar(320)
  /// Nama tampilan. Email tidak dapat diubah lewat Setting (asumsi A-06).
  fullName         String     @map("full_name") @db.VarChar(160)
  phone            String?    @db.VarChar(32)
  passwordHash     String     @map("password_hash") @db.VarChar(255)
  roleId           String     @map("role_id") @db.Uuid
  status           UserStatus @default(PENDING_VERIFICATION)
  emailVerifiedAt  DateTime?  @map("email_verified_at") @db.Timestamptz(6)
  mfaEnabled       Boolean    @default(false) @map("mfa_enabled")
  mustChangePassword Boolean  @default(false) @map("must_change_password")
  failedLoginCount Int        @default(0) @map("failed_login_count")
  lockoutLevel     Int        @default(0) @map("lockout_level")
  lockedUntil      DateTime?  @map("locked_until") @db.Timestamptz(6)
  lastLoginAt      DateTime?  @map("last_login_at") @db.Timestamptz(6)
  passwordChangedAt DateTime  @default(now()) @map("password_changed_at") @db.Timestamptz(6)
  createdAt        DateTime   @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt        DateTime   @updatedAt @map("updated_at") @db.Timestamptz(6)

  role                Role                  @relation(fields: [roleId], references: [id])
  sessions            UserSession[]
  passwordResets      PasswordReset[]
  emailVerifications  EmailVerification[]
  mfaChallenges       MfaChallenge[]
  consents            UserConsent[]
  reports             Report[]
  uploadedProofs      ReportCompletionProof[] @relation("ProofUploader")
  voidedProofs        ReportCompletionProof[] @relation("ProofVoider")
  reviewDecisions     ReviewDecision[]
  complaintSubmissions ComplaintSubmission[]

  @@index([status])
  @@index([roleId])
  @@map("users")
}

model UserSession {
  id             String    @id @default(dbgenerated("uuid_generate_v7()")) @map("session_id") @db.Uuid
  userId         String    @map("user_id") @db.Uuid
  /// SHA-256 dari token sesi opaque. Token mentah hanya ada di cookie.
  tokenHash      String    @unique @map("token_hash") @db.VarChar(64)
  csrfToken      String    @map("csrf_token") @db.VarChar(64)
  ipAddress      String?   @map("ip_address") @db.VarChar(64)
  userAgent      String?   @map("user_agent") @db.VarChar(512)
  /// Waktu OTP terakhir diverifikasi — dasar step-up MFA (BRD 4.3).
  mfaVerifiedAt  DateTime? @map("mfa_verified_at") @db.Timestamptz(6)
  lastSeenAt     DateTime  @default(now()) @map("last_seen_at") @db.Timestamptz(6)
  idleExpiresAt  DateTime  @map("idle_expires_at") @db.Timestamptz(6)
  absoluteExpiresAt DateTime @map("absolute_expires_at") @db.Timestamptz(6)
  revokedAt      DateTime? @map("revoked_at") @db.Timestamptz(6)
  revokedReason  String?   @map("revoked_reason") @db.VarChar(128)
  createdAt      DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([idleExpiresAt])
  @@map("user_sessions")
}

model PasswordReset {
  id        String    @id @default(dbgenerated("uuid_generate_v7()")) @map("reset_id") @db.Uuid
  userId    String    @map("user_id") @db.Uuid
  tokenHash String    @unique @map("token_hash") @db.VarChar(64)
  expiresAt DateTime  @map("expires_at") @db.Timestamptz(6)
  usedAt    DateTime? @map("used_at") @db.Timestamptz(6)
  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("password_resets")
}

model EmailVerification {
  id        String    @id @default(dbgenerated("uuid_generate_v7()")) @map("verification_id") @db.Uuid
  userId    String    @map("user_id") @db.Uuid
  tokenHash String    @unique @map("token_hash") @db.VarChar(64)
  expiresAt DateTime  @map("expires_at") @db.Timestamptz(6)
  usedAt    DateTime? @map("used_at") @db.Timestamptz(6)
  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("email_verifications")
}

model MfaChallenge {
  id             String    @id @default(dbgenerated("uuid_generate_v7()")) @map("challenge_id") @db.Uuid
  userId         String    @map("user_id") @db.Uuid
  otpHash        String    @map("otp_hash") @db.VarChar(64)
  /// LOGIN atau STEP_UP
  purpose        String    @default("LOGIN") @db.VarChar(16)
  expiresAt      DateTime  @map("expires_at") @db.Timestamptz(6)
  attempts       Int       @default(0)
  usedAt         DateTime? @map("used_at") @db.Timestamptz(6)
  /// Mengikat OTP ke satu percobaan login (BRD 4.3 "Pengikatan").
  sessionBinding String    @map("session_binding") @db.VarChar(64)
  ipAddress      String?   @map("ip_address") @db.VarChar(64)
  createdAt      DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, createdAt])
  @@map("mfa_challenges")
}

model UserConsent {
  id              String              @id @default(dbgenerated("uuid_generate_v7()")) @map("consent_id") @db.Uuid
  userId          String              @map("user_id") @db.Uuid
  documentType    ConsentDocumentType @map("document_type")
  documentVersion String              @map("document_version") @db.VarChar(32)
  acceptedAt      DateTime            @default(now()) @map("accepted_at") @db.Timestamptz(6)
  ipAddress       String?             @map("ip_address") @db.VarChar(64)
  reportId        String?             @map("report_id") @db.Uuid

  user   User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  report Report? @relation(fields: [reportId], references: [id])

  @@index([userId, documentType])
  @@index([reportId])
  @@map("user_consents")
}

// ========================================================== master ============

model SocialPlatform {
  id        String   @id @default(dbgenerated("uuid_generate_v7()")) @map("platform_id") @db.Uuid
  code      String   @unique @db.VarChar(32)
  name      String   @db.VarChar(64)
  /// Domain yang diizinkan untuk pengambilan metadata (allowlist, BRD 4.2).
  domains   String[] @db.VarChar(128)
  reportUrl String?  @map("report_url") @db.VarChar(512)
  active    Boolean  @default(true)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  policies        PlatformPolicy[]
  targetSnapshots TargetSnapshot[]

  @@map("social_platforms")
}

model PlatformPolicy {
  id         String   @id @default(dbgenerated("uuid_generate_v7()")) @map("policy_id") @db.Uuid
  platformId String   @map("platform_id") @db.Uuid
  code       String   @db.VarChar(64)
  name       String   @db.VarChar(256)
  category   String?  @db.VarChar(128)
  archivedAt DateTime? @map("archived_at") @db.Timestamptz(6)
  createdAt  DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  platform SocialPlatform          @relation(fields: [platformId], references: [id])
  versions PlatformPolicyVersion[]
  reportPolicies ReportPolicy[]

  @@unique([platformId, code])
  @@map("platform_policies")
}

model PlatformPolicyVersion {
  id            String    @id @default(dbgenerated("uuid_generate_v7()")) @map("policy_version_id") @db.Uuid
  policyId      String    @map("policy_id") @db.Uuid
  version       String    @db.VarChar(32)
  text          String    @db.Text
  sourceUrl     String?   @map("source_url") @db.VarChar(512)
  effectiveFrom DateTime  @map("effective_from") @db.Timestamptz(6)
  effectiveTo   DateTime? @map("effective_to") @db.Timestamptz(6)
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)

  policy         PlatformPolicy @relation(fields: [policyId], references: [id])
  reportPolicies ReportPolicy[]

  @@unique([policyId, version])
  @@map("platform_policy_versions")
}

model Law {
  id         String   @id @default(dbgenerated("uuid_generate_v7()")) @map("law_id") @db.Uuid
  code       String   @unique @db.VarChar(64)
  name       String   @db.VarChar(256)
  shortName  String?  @map("short_name") @db.VarChar(128)
  archivedAt DateTime? @map("archived_at") @db.Timestamptz(6)
  createdAt  DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  versions   LegalVersion[]
  amendments LegalAmendment[]

  @@map("laws")
}

model LegalVersion {
  id            String    @id @default(dbgenerated("uuid_generate_v7()")) @map("legal_version_id") @db.Uuid
  lawId         String    @map("law_id") @db.Uuid
  version       String    @db.VarChar(64)
  effectiveFrom DateTime  @map("effective_from") @db.Timestamptz(6)
  effectiveTo   DateTime? @map("effective_to") @db.Timestamptz(6)
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)

  law      Law            @relation(fields: [lawId], references: [id])
  articles LegalArticle[]

  @@unique([lawId, version])
  @@map("legal_versions")
}

model LegalArticle {
  id             String   @id @default(dbgenerated("uuid_generate_v7()")) @map("article_id") @db.Uuid
  legalVersionId String   @map("legal_version_id") @db.Uuid
  number         String   @db.VarChar(32)
  title          String?  @db.VarChar(256)
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  legalVersion LegalVersion     @relation(fields: [legalVersionId], references: [id])
  paragraphs   LegalParagraph[]

  @@unique([legalVersionId, number])
  @@map("legal_articles")
}

model LegalParagraph {
  id          String   @id @default(dbgenerated("uuid_generate_v7()")) @map("paragraph_id") @db.Uuid
  articleId   String   @map("article_id") @db.Uuid
  number      String   @db.VarChar(32)
  text        String   @db.Text
  explanation String?  @db.Text
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  article           LegalArticle       @relation(fields: [articleId], references: [id])
  reportLegalBasis  ReportLegalBasis[]

  @@unique([articleId, number])
  @@map("legal_paragraphs")
}

model LegalAmendment {
  id          String   @id @default(dbgenerated("uuid_generate_v7()")) @map("amendment_id") @db.Uuid
  lawId       String   @map("law_id") @db.Uuid
  title       String   @db.VarChar(256)
  description String?  @db.Text
  issuedAt    DateTime @map("issued_at") @db.Timestamptz(6)
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  law Law @relation(fields: [lawId], references: [id])

  @@map("legal_amendments")
}

model ActionType {
  id        String   @id @default(dbgenerated("uuid_generate_v7()")) @map("action_type_id") @db.Uuid
  /// REPORT_POST | REPORT_ACCOUNT
  code      String   @unique @db.VarChar(32)
  name      String   @db.VarChar(128)
  active    Boolean  @default(true)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  reports Report[]

  @@map("action_types")
}

// ========================================================= pricing ============

model Package {
  id        String   @id @default(dbgenerated("uuid_generate_v7()")) @map("package_id") @db.Uuid
  code      String   @unique @db.VarChar(32)
  quantity  Int
  active    Boolean  @default(true)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  reports Report[]

  @@map("packages")
}

model PricingConfig {
  id            String    @id @default(dbgenerated("uuid_generate_v7()")) @map("pricing_id") @db.Uuid
  /// Harga per unit dalam rupiah penuh.
  unitPrice     BigInt    @map("unit_price")
  effectiveFrom DateTime  @map("effective_from") @db.Timestamptz(6)
  effectiveTo   DateTime? @map("effective_to") @db.Timestamptz(6)
  createdBy     String?   @map("created_by") @db.Uuid
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)

  @@index([effectiveFrom])
  @@map("pricing_config")
}

model TaxConfig {
  id            String    @id @default(dbgenerated("uuid_generate_v7()")) @map("tax_id") @db.Uuid
  taxName       String    @default("PPN") @map("tax_name") @db.VarChar(32)
  /// Basis poin: 1100 = 11,00%.
  rateBp        Int       @map("rate_bp")
  effectiveFrom DateTime  @map("effective_from") @db.Timestamptz(6)
  effectiveTo   DateTime? @map("effective_to") @db.Timestamptz(6)
  createdBy     String?   @map("created_by") @db.Uuid
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)

  @@index([effectiveFrom])
  @@map("tax_config")
}

model PaymentMethod {
  id        String   @id @default(dbgenerated("uuid_generate_v7()")) @map("payment_method_id") @db.Uuid
  code      String   @unique @db.VarChar(32)
  name      String   @db.VarChar(128)
  /// VIRTUAL_ACCOUNT | EWALLET
  group     String   @db.VarChar(32)
  active    Boolean  @default(true)
  sortOrder Int      @default(0) @map("sort_order")

  @@map("payment_methods")
}

// ========================================================== report ============

model TargetSnapshot {
  id           String      @id @default(dbgenerated("uuid_generate_v7()")) @map("target_snapshot_id") @db.Uuid
  originalUrl  String      @map("original_url") @db.VarChar(2048)
  canonicalUrl String?     @map("canonical_url") @db.VarChar(2048)
  platformId   String?     @map("platform_id") @db.Uuid
  metadataJson Json?       @map("metadata_json")
  fetchedAt    DateTime?   @map("fetched_at") @db.Timestamptz(6)
  fetchStatus  FetchStatus @default(MANUAL) @map("fetch_status")
  fetchError   String?     @map("fetch_error") @db.VarChar(512)
  createdAt    DateTime    @default(now()) @map("created_at") @db.Timestamptz(6)

  platform SocialPlatform? @relation(fields: [platformId], references: [id])
  reports  Report[]

  @@map("target_snapshots")
}

model Report {
  id           String       @id @default(dbgenerated("uuid_generate_v7()")) @map("report_id") @db.Uuid
  /// Kode publik acak, tidak berurutan: RPT-XXXXXXXXXX (BRD 4.5).
  reportCode   String       @unique @map("report_code") @db.VarChar(20)
  userId       String       @map("user_id") @db.Uuid
  status       ReportStatus @default(DRAFT)
  actionTypeId String       @map("action_type_id") @db.Uuid
  packageId    String       @map("package_id") @db.Uuid
  packageQuantity Int       @map("package_quantity")
  targetSnapshotId String?  @map("target_snapshot_id") @db.Uuid
  retryCount   Int          @default(0) @map("retry_count")
  description  String?      @db.Text

  // ---- snapshot harga (BRD 6.2) — beku setelah status >= WAITING_PAYMENT
  unitPriceSnapshot   BigInt? @map("unit_price_snapshot")
  subtotalSnapshot    BigInt? @map("subtotal_snapshot")
  taxRateBpSnapshot   Int?    @map("tax_rate_bp_snapshot")
  taxAmountSnapshot   BigInt? @map("tax_amount_snapshot")
  totalAmountSnapshot BigInt? @map("total_amount_snapshot")

  // ---- snapshot policy
  platformNameSnapshot  String? @map("platform_name_snapshot") @db.VarChar(64)
  policyNameSnapshot    String? @map("policy_name_snapshot") @db.VarChar(256)
  policyVersionSnapshot String? @map("policy_version_snapshot") @db.VarChar(32)
  policyTextSnapshot    String? @map("policy_text_snapshot") @db.Text
  otherPolicyReason     String? @map("other_policy_reason") @db.Text

  // ---- snapshot legal (v1.0)
  lawNameSnapshot         String? @map("law_name_snapshot") @db.VarChar(256)
  lawVersionSnapshot      String? @map("law_version_snapshot") @db.VarChar(64)
  articleNumberSnapshot   String? @map("article_number_snapshot") @db.VarChar(32)
  paragraphNumberSnapshot String? @map("paragraph_number_snapshot") @db.VarChar(32)
  textSnapshot            String? @map("text_snapshot") @db.Text
  explanationSnapshot     String? @map("explanation_snapshot") @db.Text
  otherLegalReason        String? @map("other_legal_reason") @db.Text

  snapshotSealedAt DateTime? @map("snapshot_sealed_at") @db.Timestamptz(6)
  submittedAt      DateTime? @map("submitted_at") @db.Timestamptz(6)
  completedAt      DateTime? @map("completed_at") @db.Timestamptz(6)
  expiredAt        DateTime? @map("expired_at") @db.Timestamptz(6)
  archivedAt       DateTime? @map("archived_at") @db.Timestamptz(6)
  createdAt        DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt        DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)

  user           User            @relation(fields: [userId], references: [id])
  actionType     ActionType      @relation(fields: [actionTypeId], references: [id])
  package        Package         @relation(fields: [packageId], references: [id])
  targetSnapshot TargetSnapshot? @relation(fields: [targetSnapshotId], references: [id])

  statusHistory   ReportStatusHistory[]
  policies        ReportPolicy[]
  legalBasis      ReportLegalBasis[]
  evidences       Evidence[]
  documents       ReportDocument[]
  proofs          ReportCompletionProof[]
  payments        Payment[]
  invoices        Invoice[]
  reviewDecisions ReviewDecision[]
  complaints      ComplaintSubmission[]
  outboxEvents    OutboxEvent[]
  consents        UserConsent[]

  @@index([userId, status])
  @@index([status, createdAt])
  @@map("reports")
}

model ReportStatusHistory {
  id          String        @id @default(dbgenerated("uuid_generate_v7()")) @map("history_id") @db.Uuid
  reportId    String        @map("report_id") @db.Uuid
  fromStatus  ReportStatus? @map("from_status")
  toStatus    ReportStatus  @map("to_status")
  actorId     String?       @map("actor_id") @db.Uuid
  actorRole   String?       @map("actor_role") @db.VarChar(64)
  reason      String?       @db.Text
  occurredAt  DateTime      @default(now()) @map("occurred_at") @db.Timestamptz(6)

  report Report @relation(fields: [reportId], references: [id], onDelete: Cascade)

  @@index([reportId, occurredAt])
  @@map("report_status_history")
}

model ReportPolicy {
  id              String   @id @default(dbgenerated("uuid_generate_v7()")) @map("report_policy_id") @db.Uuid
  reportId        String   @map("report_id") @db.Uuid
  policyId        String?  @map("policy_id") @db.Uuid
  policyVersionId String?  @map("policy_version_id") @db.Uuid
  /// Salinan teks pada saat report dibuat.
  nameSnapshot    String   @map("name_snapshot") @db.VarChar(256)
  versionSnapshot String?  @map("version_snapshot") @db.VarChar(32)
  textSnapshot    String?  @map("text_snapshot") @db.Text
  otherReason     String?  @map("other_reason") @db.Text
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  report        Report                 @relation(fields: [reportId], references: [id], onDelete: Cascade)
  policy        PlatformPolicy?        @relation(fields: [policyId], references: [id])
  policyVersion PlatformPolicyVersion? @relation(fields: [policyVersionId], references: [id])

  @@index([reportId])
  @@map("report_policies")
}

model ReportLegalBasis {
  id              String   @id @default(dbgenerated("uuid_generate_v7()")) @map("report_legal_id") @db.Uuid
  reportId        String   @map("report_id") @db.Uuid
  paragraphId     String?  @map("paragraph_id") @db.Uuid
  lawNameSnapshot String   @map("law_name_snapshot") @db.VarChar(256)
  lawVersionSnapshot String? @map("law_version_snapshot") @db.VarChar(64)
  articleNumberSnapshot String? @map("article_number_snapshot") @db.VarChar(32)
  paragraphNumberSnapshot String? @map("paragraph_number_snapshot") @db.VarChar(32)
  textSnapshot    String?  @map("text_snapshot") @db.Text
  explanationSnapshot String? @map("explanation_snapshot") @db.Text
  otherReason     String?  @map("other_reason") @db.Text
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  report    Report          @relation(fields: [reportId], references: [id], onDelete: Cascade)
  paragraph LegalParagraph? @relation(fields: [paragraphId], references: [id])

  @@index([reportId])
  @@map("report_legal_basis")
}

model ReviewDecision {
  id            String             @id @default(dbgenerated("uuid_generate_v7()")) @map("decision_id") @db.Uuid
  reportId      String             @map("report_id") @db.Uuid
  decision      ReviewDecisionType
  reason        String             @db.Text
  checklistJson Json?              @map("checklist_json")
  decidedBy     String             @map("decided_by") @db.Uuid
  decidedAt     DateTime           @default(now()) @map("decided_at") @db.Timestamptz(6)

  report Report @relation(fields: [reportId], references: [id], onDelete: Cascade)
  user   User   @relation(fields: [decidedBy], references: [id])

  @@index([reportId])
  @@map("review_decisions")
}

model ComplaintSubmission {
  id                String   @id @default(dbgenerated("uuid_generate_v7()")) @map("submission_id") @db.Uuid
  reportId          String   @map("report_id") @db.Uuid
  /// IN_APP_FORM | EMAIL | WEB_FORM | LAW_ENFORCEMENT_PORTAL | KOMDIGI_EMAIL
  channel           String   @db.VarChar(64)
  submittedBy       String   @map("submitted_by") @db.Uuid
  submittedAt       DateTime @map("submitted_at") @db.Timestamptz(6)
  /// Nomor tiket yang diberikan instansi tujuan.
  externalReference String?  @map("external_reference") @db.VarChar(256)
  notes             String?  @db.Text

  // ---- pelacakan pengiriman otomatis (migrasi 0008)
  deliveryStatus ComplaintDeliveryStatus @default(PENDING) @map("delivery_status")
  /// Message-ID SMTP surat yang dikirim sistem.
  messageId      String?                 @map("message_id") @db.VarChar(512)
  /// SHA-256 berkas surat, untuk menautkan baris ini ke dokumen yang dikirim.
  payloadHash    String?                 @map("payload_hash") @db.VarChar(64)
  attemptCount   Int                     @default(0) @map("attempt_count")
  lastAttemptAt  DateTime?               @map("last_attempt_at") @db.Timestamptz(6)
  lastError      String?                 @map("last_error") @db.VarChar(512)

  createdAt         DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  report Report @relation(fields: [reportId], references: [id], onDelete: Cascade)
  user   User   @relation(fields: [submittedBy], references: [id])

  @@index([reportId])
  @@index([deliveryStatus, lastAttemptAt])
  // Indeks unique parsial penjaga kiriman ganda ke Komdigi hanya ada di
  // migrasi 0008; Prisma belum mendukung predikat WHERE pada indeks.
  @@map("complaint_submissions")
}

// ======================================================== evidence ============

model Evidence {
  id          String     @id @default(dbgenerated("uuid_generate_v7()")) @map("evidence_id") @db.Uuid
  reportId    String     @map("report_id") @db.Uuid
  fileName    String     @map("file_name") @db.VarChar(256)
  fileType    String     @map("file_type") @db.VarChar(64)
  fileSize    Int        @map("file_size")
  fileHash    String     @map("file_hash") @db.VarChar(64)
  storagePath String     @map("storage_path") @db.VarChar(512)
  caption     String?    @db.VarChar(500)
  scanStatus  ScanStatus @default(PENDING) @map("scan_status")
  scanMessage String?    @map("scan_message") @db.VarChar(256)
  scannedAt   DateTime?  @map("scanned_at") @db.Timestamptz(6)
  createdAt   DateTime   @default(now()) @map("created_at") @db.Timestamptz(6)

  report Report @relation(fields: [reportId], references: [id], onDelete: Cascade)

  @@index([reportId])
  @@map("evidences")
}

model ReportDocument {
  id          String   @id @default(dbgenerated("uuid_generate_v7()")) @map("document_id") @db.Uuid
  reportId    String   @map("report_id") @db.Uuid
  /// REPORT_PDF | INVOICE_PDF
  documentType String  @map("document_type") @db.VarChar(32)
  version     Int
  fileName    String   @map("file_name") @db.VarChar(256)
  fileHash    String   @map("file_hash") @db.VarChar(64)
  fileSize    Int      @map("file_size")
  storagePath String   @map("storage_path") @db.VarChar(512)
  includesProofs Boolean @default(false) @map("includes_proofs")
  generatedAt DateTime @default(now()) @map("generated_at") @db.Timestamptz(6)

  report Report @relation(fields: [reportId], references: [id], onDelete: Cascade)

  @@unique([reportId, documentType, version])
  @@index([reportId])
  @@map("report_documents")
}

/// Bukti Pengerjaan — BRD bagian 8 (fitur baru v1.1).
model ReportCompletionProof {
  id            String     @id @default(dbgenerated("uuid_generate_v7()")) @map("proof_id") @db.Uuid
  reportId      String     @map("report_id") @db.Uuid
  uploadedBy    String     @map("uploaded_by") @db.Uuid
  proofType     ProofType  @map("proof_type")
  /// Waktu pelaporan benar-benar dilakukan admin (bukan waktu unggah).
  reportedAt    DateTime   @map("reported_at") @db.Timestamptz(6)
  caption       String?    @db.VarChar(500)
  unitsReported Int?       @map("units_reported")
  fileName      String     @map("file_name") @db.VarChar(256)
  fileType      String     @map("file_type") @db.VarChar(64)
  fileSize      Int        @map("file_size")
  fileHash      String     @map("file_hash") @db.VarChar(64)
  storagePath   String     @map("storage_path") @db.VarChar(512)
  scanStatus    ScanStatus @default(PENDING) @map("scan_status")
  scanMessage   String?    @map("scan_message") @db.VarChar(256)
  visibleToUser Boolean    @default(true) @map("visible_to_user")
  voidedAt      DateTime?  @map("voided_at") @db.Timestamptz(6)
  voidedBy      String?    @map("voided_by") @db.Uuid
  voidReason    String?    @map("void_reason") @db.Text
  createdAt     DateTime   @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt     DateTime   @updatedAt @map("updated_at") @db.Timestamptz(6)

  report   Report @relation(fields: [reportId], references: [id], onDelete: Cascade)
  uploader User   @relation("ProofUploader", fields: [uploadedBy], references: [id])
  voider   User?  @relation("ProofVoider", fields: [voidedBy], references: [id])

  @@index([reportId, voidedAt])
  @@map("report_completion_proofs")
}

// ========================================================= payment ============

model Invoice {
  id            String   @id @default(dbgenerated("uuid_generate_v7()")) @map("invoice_id") @db.Uuid
  invoiceNumber String   @unique @map("invoice_number") @db.VarChar(32)
  reportId      String   @map("report_id") @db.Uuid
  subtotal      BigInt
  taxRateBp     Int      @map("tax_rate_bp")
  taxAmount     BigInt   @map("tax_amount")
  total         BigInt
  issuedAt      DateTime @default(now()) @map("issued_at") @db.Timestamptz(6)
  documentId    String?  @map("document_id") @db.Uuid

  report Report @relation(fields: [reportId], references: [id], onDelete: Cascade)

  @@index([reportId])
  @@map("invoices")
}

model Payment {
  id              String        @id @default(dbgenerated("uuid_generate_v7()")) @map("payment_id") @db.Uuid
  reportId        String        @map("report_id") @db.Uuid
  invoiceId       String?       @map("invoice_id") @db.Uuid
  provider        String        @db.VarChar(64)
  gatewayOrderId  String        @unique @map("gateway_order_id") @db.VarChar(128)
  paymentMethod   String?       @map("payment_method") @db.VarChar(64)
  subtotal        BigInt
  taxAmount       BigInt        @map("tax_amount")
  totalAmount     BigInt        @map("total_amount")
  paidAmount      BigInt        @default(0) @map("paid_amount")
  overpaidAmount  BigInt        @default(0) @map("overpaid_amount")
  status          PaymentStatus @default(PENDING)
  checkoutUrl     String?       @map("checkout_url") @db.VarChar(512)
  expiresAt       DateTime      @map("expires_at") @db.Timestamptz(6)
  paidAt          DateTime?     @map("paid_at") @db.Timestamptz(6)
  createdAt       DateTime      @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime      @updatedAt @map("updated_at") @db.Timestamptz(6)

  report        Report                 @relation(fields: [reportId], references: [id], onDelete: Cascade)
  transactions  PaymentTransaction[]
  verifications PaymentVerification[]
  reconciliations PaymentReconciliation[]

  @@index([reportId])
  @@index([status, expiresAt])
  @@map("payments")
}

model PaymentTransaction {
  id              String   @id @default(dbgenerated("uuid_generate_v7()")) @map("transaction_id") @db.Uuid
  paymentId       String   @map("payment_id") @db.Uuid
  providerEventId String   @map("provider_event_id") @db.VarChar(128)
  rawPayload      Json     @map("raw_payload")
  status          String   @db.VarChar(32)
  amount          BigInt
  receivedAt      DateTime @default(now()) @map("received_at") @db.Timestamptz(6)

  payment Payment @relation(fields: [paymentId], references: [id], onDelete: Cascade)

  @@index([paymentId])
  @@map("payment_transactions")
}

/// Hanya untuk verifikasi manual kasus pengecualian (BRD 5.2).
model PaymentVerification {
  id         String   @id @default(dbgenerated("uuid_generate_v7()")) @map("verification_id") @db.Uuid
  paymentId  String   @map("payment_id") @db.Uuid
  reason     String   @db.Text
  decision   String   @db.VarChar(32)
  verifiedBy String   @map("verified_by") @db.Uuid
  verifiedAt DateTime @default(now()) @map("verified_at") @db.Timestamptz(6)

  payment Payment @relation(fields: [paymentId], references: [id], onDelete: Cascade)

  @@index([paymentId])
  @@map("payment_verifications")
}

model PaymentReconciliation {
  id            String    @id @default(dbgenerated("uuid_generate_v7()")) @map("reconciliation_id") @db.Uuid
  runDate       DateTime  @map("run_date") @db.Date
  paymentId     String?   @map("payment_id") @db.Uuid
  gatewayStatus String?   @map("gateway_status") @db.VarChar(32)
  dbStatus      String?   @map("db_status") @db.VarChar(32)
  difference    BigInt    @default(0)
  note          String?   @db.Text
  resolvedBy    String?   @map("resolved_by") @db.Uuid
  resolvedAt    DateTime? @map("resolved_at") @db.Timestamptz(6)
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)

  payment Payment? @relation(fields: [paymentId], references: [id])

  @@index([runDate])
  @@map("payment_reconciliations")
}

model WebhookEvent {
  id              String   @id @default(dbgenerated("uuid_generate_v7()")) @map("webhook_event_id") @db.Uuid
  provider        String   @db.VarChar(64)
  providerEventId String   @map("provider_event_id") @db.VarChar(128)
  signatureValid  Boolean  @map("signature_valid")
  rawPayload      Json     @map("raw_payload")
  receivedAt      DateTime @default(now()) @map("received_at") @db.Timestamptz(6)
  processedAt     DateTime? @map("processed_at") @db.Timestamptz(6)
  processError    String?  @map("process_error") @db.VarChar(512)

  @@unique([provider, providerEventId])
  @@map("webhook_events")
}

// ==================================================== notifikasi ============

model OutboxEvent {
  id            String       @id @default(dbgenerated("uuid_generate_v7()")) @map("event_id") @db.Uuid
  eventType     String       @map("event_type") @db.VarChar(64)
  reportId      String?      @map("report_id") @db.Uuid
  payloadJson   Json         @map("payload_json")
  status        OutboxStatus @default(PENDING)
  attempts      Int          @default(0)
  nextAttemptAt DateTime     @default(now()) @map("next_attempt_at") @db.Timestamptz(6)
  lastError     String?      @map("last_error") @db.VarChar(1024)
  createdAt     DateTime     @default(now()) @map("created_at") @db.Timestamptz(6)
  dispatchedAt  DateTime?    @map("dispatched_at") @db.Timestamptz(6)

  report Report? @relation(fields: [reportId], references: [id], onDelete: SetNull)
  logs   NotificationLog[]

  @@index([status, nextAttemptAt])
  @@map("outbox_events")
}

model NotificationLog {
  id          String             @id @default(dbgenerated("uuid_generate_v7()")) @map("log_id") @db.Uuid
  eventId     String?            @map("event_id") @db.Uuid
  channel     NotificationChannel
  target      String?            @db.VarChar(256)
  result      NotificationResult
  httpStatus  Int?               @map("http_status")
  detail      String?            @db.VarChar(1024)
  attempt     Int                @default(1)
  durationMs  Int?               @map("duration_ms")
  createdAt   DateTime           @default(now()) @map("created_at") @db.Timestamptz(6)

  event OutboxEvent? @relation(fields: [eventId], references: [id], onDelete: SetNull)

  @@index([eventId])
  @@map("notification_logs")
}

model IdempotencyKey {
  key         String   @id @db.VarChar(128)
  scope       String   @db.VarChar(64)
  requestHash String   @map("request_hash") @db.VarChar(64)
  responseRef String?  @map("response_ref") @db.VarChar(256)
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  @@map("idempotency_keys")
}

/// Kotak masuk email lokal untuk driver MAIL_DRIVER=mailbox.
/// Menggantikan penyedia email transaksional saat pengembangan.
model DevMailbox {
  id        String   @id @default(dbgenerated("uuid_generate_v7()")) @map("mail_id") @db.Uuid
  toAddress String   @map("to_address") @db.VarChar(320)
  subject   String   @db.VarChar(256)
  bodyText  String   @map("body_text") @db.Text
  bodyHtml  String?  @map("body_html") @db.Text
  /// Kode OTP / token yang disorot agar mudah dipakai saat uji coba.
  highlight String?  @db.VarChar(128)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  @@index([toAddress, createdAt])
  @@map("dev_mailbox")
}

// ========================================================== audit ============

/// Append-only. Role aplikasi hanya punya INSERT/SELECT; UPDATE dan DELETE
/// diblokir trigger (lihat migrasi 02_audit_append_only).
model AuditLog {
  id         String   @id @default(dbgenerated("uuid_generate_v7()")) @map("audit_id") @db.Uuid
  /// Urutan monotonik untuk rantai hash.
  seq        BigInt   @unique @default(autoincrement())
  occurredAt DateTime @default(now()) @map("occurred_at") @db.Timestamptz(6)
  actorId    String?  @map("actor_id") @db.Uuid
  actorRole  String?  @map("actor_role") @db.VarChar(64)
  ipAddress  String?  @map("ip_address") @db.VarChar(64)
  userAgent  String?  @map("user_agent") @db.VarChar(512)
  action     String   @db.VarChar(64)
  entityType String?  @map("entity_type") @db.VarChar(64)
  entityId   String?  @map("entity_id") @db.VarChar(64)
  beforeJson Json?    @map("before_json")
  afterJson  Json?    @map("after_json")
  requestId  String?  @map("request_id") @db.VarChar(64)
  prevHash   String   @map("prev_hash") @db.VarChar(64)
  entryHash  String   @map("entry_hash") @db.VarChar(64)

  @@index([occurredAt])
  @@index([action])
  @@index([entityType, entityId])
  @@map("audit_logs")
}

/// Checkpoint harian rantai hash audit (diekspor ke object storage WORM).
model AuditCheckpoint {
  id        String   @id @default(dbgenerated("uuid_generate_v7()")) @map("checkpoint_id") @db.Uuid
  forDate   DateTime @unique @map("for_date") @db.Date
  lastSeq   BigInt   @map("last_seq")
  lastHash  String   @map("last_hash") @db.VarChar(64)
  verified  Boolean  @default(false)
  storagePath String? @map("storage_path") @db.VarChar(512)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  @@map("audit_checkpoints")
}

-- =============================================================================
-- 0008_komdigi_forwarding — pelacakan pengiriman berkas ke Komdigi
--
-- Sampai migrasi ini, `complaint_submissions` hanya mencatat bahwa admin sudah
-- melapor lewat jalur resmi di luar sistem: kanal, waktu, nomor acuan. Cukup
-- selama pengirimannya dilakukan manusia.
--
-- Penerusan ke Komdigi dikerjakan job, jadi barisnya harus menyimpan riwayat
-- percobaannya sendiri: sudah terkirim atau belum, berapa kali dicoba, kenapa
-- gagal. Tanpa itu, satu kegagalan jaringan tidak dapat dibedakan dari surat
-- yang benar-benar sampai, dan job akan mengirim ulang berkas yang sudah
-- diterima instansi.
--
-- Kolom lama tetap dipakai dan artinya tidak berubah:
--   * `external_reference` — nomor tiket yang DIBERIKAN Komdigi;
--   * `message_id`         — Message-ID SMTP surat yang KITA kirim.
-- Keduanya berbeda asal, jadi disimpan terpisah.
-- =============================================================================

CREATE TYPE "ComplaintDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'DEAD');

ALTER TABLE "complaint_submissions"
  ADD COLUMN "delivery_status" "ComplaintDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "message_id"      VARCHAR(512),
  ADD COLUMN "payload_hash"    VARCHAR(64),
  ADD COLUMN "attempt_count"   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_attempt_at" TIMESTAMPTZ(6),
  ADD COLUMN "last_error"      VARCHAR(512);

-- Baris yang sudah ada dibuat oleh admin SETELAH ia melapor sendiri ke jalur
-- resmi. Pengirimannya sudah terjadi, jadi statusnya SENT, bukan PENDING.
UPDATE "complaint_submissions" SET "delivery_status" = 'SENT';

-- ---------------------------------------------------------------------------
-- Penjaga kiriman ganda.
--
-- Indeks ini sengaja parsial, bukan unique penuh pada (report_id, channel).
-- Alasannya dua.
--
-- Pertama, tabel 7.2 baris 22 mengizinkan FAILED kembali ke SUBMITTED, artinya
-- percobaan ulang setelah kegagalan memang sah. Unique penuh akan memblokirnya.
-- Dengan predikat di bawah, baris FAILED dan DEAD tidak lagi menghalangi
-- percobaan berikutnya, sedangkan PENDING atau SENT menghalangi.
--
-- Kedua, predikat dibatasi pada kanal Komdigi saja. Kanal lain dicatat manual
-- oleh admin dan boleh berulang; membatasi keduanya sekaligus akan menolak data
-- lama yang sudah terlanjur ada.
--
-- Prisma belum mendukung indeks parsial di schema, jadi indeks ini hidup hanya
-- di SQL. Jangan hapus ketika `prisma migrate` melaporkan selisih.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "complaint_submissions_komdigi_live_uniq"
  ON "complaint_submissions" ("report_id")
  WHERE "channel" = 'KOMDIGI_EMAIL'
    AND "delivery_status" IN ('PENDING', 'SENT');

-- Dipakai job untuk mengambil kiriman yang perlu dicoba ulang.
CREATE INDEX "complaint_submissions_delivery_idx"
  ON "complaint_submissions" ("delivery_status", "last_attempt_at");

/**
 * Gate kelayakan penerusan report ke Komdigi — jalur pelaporan resmi.
 *
 * Berkas ini menjawab satu pertanyaan saja: apakah sebuah report boleh
 * diteruskan ke kanal pengaduan konten Komdigi? Jawabannya harus dapat
 * dipertanggungjawabkan, karena surat yang dikirim mengatasnamakan sistem ini
 * kepada instansi negara. Maka syaratnya dibuat ketat dan eksplisit:
 * satu dasar hukum yang benar-benar tertaut ke pasal di basis data, bukan
 * teks bebas yang diketik pengguna.
 *
 * Seperti `reports/state-machine.ts`, berkas ini sengaja tidak mengimpor
 * apa pun selain tipe. Tidak ada Prisma, tidak ada Nest, tidak ada I/O.
 * Pemanggil yang menyiapkan datanya, sehingga aturannya dapat diuji tanpa
 * database dan dijalankan ulang di dalam job pengiriman tanpa biaya.
 */

import type { ReportStatusValue } from '../reports/state-machine';

// ------------------------------------------------------------- konstanta ---

/**
 * Nilai `complaint_submissions.channel` untuk penerusan ke Komdigi.
 *
 * Indeks unique parsial di migrasi 0008 memakai string ini apa adanya, jadi
 * mengubahnya di sini saja tidak cukup — migrasi harus ikut diubah.
 */
export const KOMDIGI_CHANNEL = 'KOMDIGI_EMAIL';

/** Kode `laws.code` yang dipakai sebagai dasar permintaan pemutusan akses. */
export const KOMDIGI_LAW_CODE = 'UU_ITE';

/**
 * Pasal "Perbuatan yang Dilarang" UU ITE yang dapat menjadi dasar permintaan
 * pemutusan akses konten.
 *
 * Catatan penting: pasal di daftar ini adalah muatan yang dilanggar, BUKAN
 * dasar kewenangan pemutusan aksesnya. Kewenangan itu ada pada Pasal 40
 * ayat (2a) dan (2b) UU ITE dan dipegang pemerintah, bukan pelapor.
 *
 * Daftar sengaja konservatif. Pasal di luar daftar ini tetap sah dipakai
 * sebagai dasar report di dalam sistem, tetapi tidak cukup untuk meneruskan
 * berkas ke Komdigi. Menambah pasal di sini adalah keputusan hukum, bukan
 * keputusan teknis — ubah hanya setelah dicek ke naskah UU yang berlaku.
 */
export const TAKEDOWN_ELIGIBLE_ARTICLES: readonly string[] = [
  '27',
  '27A',
  '27B',
  '28',
  '29',
];

/** Status wajib sebelum report boleh diteruskan (tabel 7.2 baris 18). */
export const REQUIRED_STATUS: ReportStatusValue = 'APPROVED';

/** Panjang minimum kronologi agar surat tidak kosong isi. */
export const MIN_DESCRIPTION_LENGTH = 50;

// ---------------------------------------------------------------- tipe -----

export const EligibilityCode = {
  STATUS_NOT_APPROVED: 'STATUS_NOT_APPROVED',
  ALREADY_FORWARDED: 'ALREADY_FORWARDED',
  NO_LEGAL_BASIS: 'NO_LEGAL_BASIS',
  LEGAL_BASIS_UNVERIFIED: 'LEGAL_BASIS_UNVERIFIED',
  NO_UU_ITE_BASIS: 'NO_UU_ITE_BASIS',
  ARTICLE_NOT_TAKEDOWN_ELIGIBLE: 'ARTICLE_NOT_TAKEDOWN_ELIGIBLE',
  NO_TARGET_URL: 'NO_TARGET_URL',
  TARGET_URL_INVALID: 'TARGET_URL_INVALID',
  NO_CLEAN_EVIDENCE: 'NO_CLEAN_EVIDENCE',
  EVIDENCE_INFECTED: 'EVIDENCE_INFECTED',
  EVIDENCE_SCAN_PENDING: 'EVIDENCE_SCAN_PENDING',
  EVIDENCE_SCAN_ERROR: 'EVIDENCE_SCAN_ERROR',
  DESCRIPTION_TOO_SHORT: 'DESCRIPTION_TOO_SHORT',
  UNUSED_LEGAL_BASIS: 'UNUSED_LEGAL_BASIS',
} as const;

export type EligibilityCodeValue =
  (typeof EligibilityCode)[keyof typeof EligibilityCode];

export type EvidenceScanStatus = 'PENDING' | 'CLEAN' | 'INFECTED' | 'ERROR';

/**
 * Satu baris `report_legal_basis`, sudah diratakan oleh pemanggil.
 *
 * `lawCode` diisi dari relasi paragraph -> article -> version -> law. Bila
 * baris itu dasar bebas (`paragraph_id` kosong), `lawCode` null dan `linked`
 * false — baris seperti itu tidak pernah dihitung sebagai dasar yang sah
 * untuk Komdigi, karena nomor pasalnya tidak dijamin siapa pun.
 */
export interface LegalBasisInput {
  lawCode: string | null;
  articleNumber: string | null;
  paragraphNumber: string | null;
  linked: boolean;
  otherReason?: string | null;
}

export interface EvidenceInput {
  scanStatus: EvidenceScanStatus;
}

export interface EligibilityInput {
  status: ReportStatusValue;
  targetUrl: string | null;
  description: string | null;
  legalBasis: readonly LegalBasisInput[];
  evidences: readonly EvidenceInput[];
  /** Sudah pernah diteruskan ke kanal Komdigi sebelumnya. */
  alreadyForwarded?: boolean;
}

export interface EligibilityFinding {
  code: EligibilityCodeValue;
  message: string;
}

export interface EligibilityResult {
  /** True hanya bila `blockers` kosong. */
  eligible: boolean;
  /** Penghalang keras. Selama ada isinya, penerusan dilarang. */
  blockers: EligibilityFinding[];
  /** Catatan yang perlu dilihat admin tetapi tidak menghalangi. */
  warnings: EligibilityFinding[];
  /** Pasal UU ITE yang lolos saring, untuk dicantumkan di surat. */
  citedArticles: string[];
  cleanEvidenceCount: number;
}

// ------------------------------------------------------------- pembantu ----

/**
 * Menyeragamkan penulisan nomor pasal agar perbandingan tidak meleset karena
 * spasi atau huruf kecil: "Pasal 27 a" dan "27A" dianggap sama.
 */
export function normalizeArticleNumber(value: string | null): string | null {
  if (!value) return null;

  const cleaned = value
    .replace(/pasal/gi, ' ')
    .replace(/[\s.]+/g, '')
    .toUpperCase();

  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Pemeriksaan bentuk URL, bukan pemeriksaan keamanan. Pertahanan SSRF ada di
 * modul fetcher; di sini cukup dipastikan surat tidak memuat alamat kosong
 * atau skema yang tidak bisa dibuka petugas.
 */
export function isPlausibleTargetUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (!parsed.hostname.includes('.')) return false;
  if (parsed.hostname.startsWith('.') || parsed.hostname.endsWith('.')) return false;

  return true;
}

function finding(
  code: EligibilityCodeValue,
  message: string,
): EligibilityFinding {
  return { code, message };
}

// --------------------------------------------------------------- aturan ----

/**
 * Menilai satu report terhadap seluruh syarat penerusan.
 *
 * Fungsi ini tidak melempar exception. Ia selalu mengembalikan hasil lengkap
 * supaya antarmuka admin bisa menampilkan seluruh penghalang sekaligus,
 * bukan satu per satu setiap kali tombol ditekan.
 */
export function evaluateKomdigiEligibility(
  input: EligibilityInput,
): EligibilityResult {
  const blockers: EligibilityFinding[] = [];
  const warnings: EligibilityFinding[] = [];

  // ---- status ----
  if (input.status !== REQUIRED_STATUS) {
    blockers.push(
      finding(
        EligibilityCode.STATUS_NOT_APPROVED,
        `Status report harus ${REQUIRED_STATUS}, saat ini ${input.status}.`,
      ),
    );
  }

  if (input.alreadyForwarded === true) {
    blockers.push(
      finding(
        EligibilityCode.ALREADY_FORWARDED,
        'Report ini sudah pernah diteruskan ke Komdigi.',
      ),
    );
  }

  // ---- dasar hukum ----
  const citedArticles = collectCitedArticles(input.legalBasis, blockers, warnings);

  // ---- URL target ----
  const targetUrl = input.targetUrl?.trim() ?? '';
  if (targetUrl.length === 0) {
    blockers.push(
      finding(
        EligibilityCode.NO_TARGET_URL,
        'URL konten yang dilaporkan belum terisi.',
      ),
    );
  } else if (!isPlausibleTargetUrl(targetUrl)) {
    blockers.push(
      finding(
        EligibilityCode.TARGET_URL_INVALID,
        'URL konten tidak valid; harus berupa tautan http atau https yang utuh.',
      ),
    );
  }

  // ---- bukti ----
  const cleanEvidenceCount = countEvidence(input.evidences, blockers, warnings);

  // ---- kronologi ----
  const description = input.description?.trim() ?? '';
  if (description.length < MIN_DESCRIPTION_LENGTH) {
    blockers.push(
      finding(
        EligibilityCode.DESCRIPTION_TOO_SHORT,
        `Kronologi minimal ${MIN_DESCRIPTION_LENGTH} karakter, saat ini ${description.length}.`,
      ),
    );
  }

  return {
    eligible: blockers.length === 0,
    blockers,
    warnings,
    citedArticles,
    cleanEvidenceCount,
  };
}

/**
 * Menyaring dasar hukum sampai tersisa pasal UU ITE yang boleh dikutip.
 *
 * Tiga saringan berurutan, masing-masing dengan pesan sendiri supaya admin
 * tahu persis apa yang kurang: ada dasarnya atau tidak, dasarnya UU ITE atau
 * bukan, dan pasalnya termasuk yang bisa dimintakan pemutusan akses atau tidak.
 */
function collectCitedArticles(
  legalBasis: readonly LegalBasisInput[],
  blockers: EligibilityFinding[],
  warnings: EligibilityFinding[],
): string[] {
  if (legalBasis.length === 0) {
    blockers.push(
      finding(
        EligibilityCode.NO_LEGAL_BASIS,
        'Report belum memiliki dasar hukum.',
      ),
    );
    return [];
  }

  const linked = legalBasis.filter((basis) => basis.linked);
  if (linked.length === 0) {
    blockers.push(
      finding(
        EligibilityCode.LEGAL_BASIS_UNVERIFIED,
        'Dasar hukum hanya berupa alasan bebas, belum tertaut ke pasal di basis data. ' +
          'Penerusan ke Komdigi menuntut pasal yang terverifikasi.',
      ),
    );
    return [];
  }

  const iteBasis = linked.filter((basis) => basis.lawCode === KOMDIGI_LAW_CODE);
  if (iteBasis.length === 0) {
    blockers.push(
      finding(
        EligibilityCode.NO_UU_ITE_BASIS,
        'Tidak ada dasar hukum UU ITE. Kanal Komdigi hanya menerima aduan ' +
          'konten dengan dasar UU ITE.',
      ),
    );
    return [];
  }

  const eligible: string[] = [];
  const rejected: string[] = [];

  for (const basis of iteBasis) {
    const article = normalizeArticleNumber(basis.articleNumber);
    if (!article) {
      rejected.push('(nomor pasal kosong)');
      continue;
    }

    if (TAKEDOWN_ELIGIBLE_ARTICLES.includes(article)) {
      if (!eligible.includes(article)) eligible.push(article);
    } else if (!rejected.includes(article)) {
      rejected.push(article);
    }
  }

  if (eligible.length === 0) {
    blockers.push(
      finding(
        EligibilityCode.ARTICLE_NOT_TAKEDOWN_ELIGIBLE,
        `Pasal yang dipakai (${rejected.join(', ')}) tidak termasuk pasal ` +
          `muatan yang dilarang UU ITE (${TAKEDOWN_ELIGIBLE_ARTICLES.join(', ')}).`,
      ),
    );
    return [];
  }

  if (rejected.length > 0) {
    warnings.push(
      finding(
        EligibilityCode.UNUSED_LEGAL_BASIS,
        `Dasar hukum ${rejected.join(', ')} tidak akan dicantumkan di surat ` +
          'karena di luar daftar pasal muatan yang dilarang.',
      ),
    );
  }

  const unlinkedCount = legalBasis.length - linked.length;
  if (unlinkedCount > 0) {
    warnings.push(
      finding(
        EligibilityCode.UNUSED_LEGAL_BASIS,
        `${unlinkedCount} alasan bebas tidak akan dicantumkan di surat.`,
      ),
    );
  }

  return eligible;
}

/**
 * Menghitung bukti yang layak dilampirkan.
 *
 * Berkas terinfeksi menghalangi keras: mengirim lampiran bervirus ke alamat
 * instansi adalah kegagalan yang tidak bisa ditarik kembali. Berkas yang
 * belum selesai dipindai hanya menghalangi bila tidak ada satu pun berkas
 * bersih, karena selebihnya cukup ditunda oleh admin.
 */
function countEvidence(
  evidences: readonly EvidenceInput[],
  blockers: EligibilityFinding[],
  warnings: EligibilityFinding[],
): number {
  let clean = 0;
  let pending = 0;
  let infected = 0;
  let errored = 0;

  for (const evidence of evidences) {
    if (evidence.scanStatus === 'CLEAN') clean += 1;
    else if (evidence.scanStatus === 'PENDING') pending += 1;
    else if (evidence.scanStatus === 'INFECTED') infected += 1;
    else errored += 1;
  }

  if (infected > 0) {
    blockers.push(
      finding(
        EligibilityCode.EVIDENCE_INFECTED,
        `${infected} berkas bukti ditandai terinfeksi; hapus berkas tersebut ` +
          'sebelum report diteruskan.',
      ),
    );
  }

  if (clean === 0) {
    blockers.push(
      finding(
        EligibilityCode.NO_CLEAN_EVIDENCE,
        'Tidak ada berkas bukti yang lolos pemindaian.',
      ),
    );
  } else if (pending > 0) {
    warnings.push(
      finding(
        EligibilityCode.EVIDENCE_SCAN_PENDING,
        `${pending} berkas bukti masih dipindai dan tidak akan ikut dilampirkan.`,
      ),
    );
  }

  if (errored > 0) {
    warnings.push(
      finding(
        EligibilityCode.EVIDENCE_SCAN_ERROR,
        `${errored} berkas bukti gagal dipindai dan tidak akan ikut dilampirkan.`,
      ),
    );
  }

  return clean;
}
