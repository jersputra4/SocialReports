# API

Basis URL: `/api/v1`. Seluruh respons JSON.

## Aturan umum

**Sesi.** Autentikasi memakai cookie sesi `srs_session` (HttpOnly, Secure, SameSite=Lax). Klien tidak pernah membaca token itu.

**CSRF.** Setiap permintaan yang mengubah data (`POST`, `PATCH`, `DELETE`) wajib membawa header `X-CSRF-Token` yang nilainya dibaca dari cookie `srs_csrf`. Pengecualian: endpoint publik dan webhook pembayaran, yang keasliannya dibuktikan tanda tangan HMAC.

**Uang.** Seluruh nilai uang dikirim sebagai **string** berisi rupiah penuh (`"333000"`), bukan number — agar tidak ada kehilangan presisi di JavaScript.

**Galat.** Bentuknya selalu sama:

```json
{
  "statusCode": 409,
  "error": "TransitionNotAllowed",
  "message": "Transisi DRAFT -> APPROVED ditolak: transisi tidak ada pada tabel 7.2",
  "requestId": "a3f19c2b4e8d",
  "details": { "from": "DRAFT", "to": "APPROVED" }
}
```

`requestId` juga dikembalikan sebagai header `X-Request-Id` dan dicatat di audit log, sehingga satu kejadian dapat ditelusuri dari keluhan pengguna sampai baris log.

**Kode status yang punya arti khusus:**

| Kode | Arti |
|---|---|
| 401 | Sesi tidak ada atau berakhir — atau, pada webhook, tanda tangan tidak valid |
| 403 | Izin tidak cukup |
| 404 | Tidak ditemukan **atau** bukan milik Anda (disamakan dengan sengaja) |
| 409 | Transisi status tidak diizinkan, atau melanggar aturan data |
| 423 | Akun terkunci sementara |
| 428 | Perlu verifikasi OTP ulang (step-up MFA) |
| 429 | Melewati batas laju; lihat `details.retryAfterSeconds` |

---

## Autentikasi

| Method | Endpoint | Akses | Keterangan |
|---|---|---|---|
| POST | `/auth/register` | publik | Respons selalu sama agar keberadaan akun tidak dapat ditebak |
| POST | `/auth/verify-email` | publik | `{ token }` |
| POST | `/auth/login` | publik | Balasan `{ mfaRequired: true, challengeId }` bila akun menuntut OTP |
| POST | `/auth/mfa/verify` | publik | `{ challengeId, otp }` — menyelesaikan proses masuk |
| POST | `/auth/mfa/resend` | publik | Jeda 60 detik, maksimal 3 per 10 menit |
| POST | `/auth/mfa/step-up/request` | sesi | Mengirim OTP untuk aksi sensitif |
| POST | `/auth/mfa/step-up/verify` | sesi | Membuka jendela 10 menit |
| POST | `/auth/mfa/enable` / `/auth/mfa/disable` | sesi | Akun internal tidak dapat menonaktifkan |
| POST | `/auth/password-reset/request` | publik | Respons seragam |
| POST | `/auth/password-reset/confirm` | publik | Mencabut seluruh sesi |
| POST | `/auth/password/change` | sesi | Mencabut sesi lain, sesi berjalan dipertahankan |
| GET | `/auth/me` | sesi | Identitas, izin, dan sisa jendela step-up |
| POST | `/auth/logout` | sesi | |

Contoh alur masuk akun internal:

```bash
# 1. kredensial
curl -X POST localhost:8080/api/v1/auth/login -c jar.txt \
  -H 'content-type: application/json' \
  -d '{"email":"admin@contoh.test","password":"..."}'
# -> {"mfaRequired":true,"challengeId":"01a0…","expiresAt":"…"}

# 2. ambil OTP dari kotak masuk lokal
curl "localhost:8080/api/v1/dev/mailbox/latest?to=admin@contoh.test"

# 3. verifikasi
curl -X POST localhost:8080/api/v1/auth/mfa/verify -b jar.txt -c jar.txt \
  -H 'content-type: application/json' \
  -d '{"challengeId":"01a0…","otp":"123456"}'
```

---

## Master data

| Method | Endpoint | Izin |
|---|---|---|
| GET | `/platforms` | sesi |
| GET | `/platforms/:platformId/policies` | sesi |
| GET | `/action-types` | sesi |
| GET | `/packages` | sesi |
| GET | `/pricing/quote?quantity=` | sesi |
| GET | `/legal/laws` | sesi |
| GET | `/legal/versions/:versionId/articles` | sesi |
| GET/POST | `/admin/policies`, `/admin/policies/:id/versions`, `/admin/policies/:id/archive` | `policy.manage` + step-up |
| GET/POST | `/admin/legal`, `/admin/legal/laws`, `/admin/legal/articles` | `legal.manage` + step-up |
| GET/POST | `/admin/pricing`, `/admin/tax` | `pricing.manage` + step-up |

---

## Report

| Method | Endpoint | Izin | Keterangan |
|---|---|---|---|
| POST | `/reports` | sesi | Membuat draf; metadata target diambil lewat Metadata Fetcher |
| GET | `/reports` | sesi | `?status=&page=&pageSize=` |
| GET | `/reports/:reportCode` | pemilik | Menyertakan `availableActions` dari state machine |
| PATCH | `/reports/:reportCode` | pemilik | Hanya saat `DRAFT` atau `NEEDS_REVISION` |
| POST | `/reports/:reportCode/policies` | pemilik | Mengganti seluruh pilihan |
| POST | `/reports/:reportCode/legal-basis` | pemilik | Mengganti seluruh pilihan |
| POST | `/reports/:reportCode/evidences` | pemilik | `multipart/form-data`, maksimal 5 MB |
| GET | `/reports/:reportCode/evidences` | pemilik | |
| GET | `/evidences/:id/download-url` | pemilik / staf | Signed URL ≤ 120 detik |
| DELETE | `/evidences/:id` | pemilik | Hanya saat report masih dapat disunting |
| POST | `/reports/:reportCode/checkout` | pemilik | Consent + bekukan snapshot + buat tagihan, dalam satu transaksi |
| POST | `/reports/:reportCode/payment/retry` | pemilik | Setelah `EXPIRED` atau `PAYMENT_REJECTED` |
| POST | `/reports/:reportCode/resubmit` | pemilik | Dari `NEEDS_REVISION`, tanpa pembayaran baru |
| POST | `/reports/:reportCode/cancel` | pemilik | |
| GET | `/reports/:reportCode/proofs` | pemilik | Hanya bukti aktif dan terlihat, plus progres unit |
| GET | `/reports/:reportCode/proofs/:proofId/download-url` | pemilik | |
| GET/POST | `/reports/:reportCode/documents` | pemilik / staf | `POST` mengantrekan pembuatan PDF versi baru |
| GET | `/documents/:documentId/download-url` | pemilik / staf | |

---

## Operasional

| Method | Endpoint | Izin |
|---|---|---|
| GET | `/admin/reports` | `report.review` |
| GET | `/admin/reports/review-queue` | `report.review` |
| GET | `/admin/reports/:reportCode` | `report.review` |
| POST | `/admin/reports/:reportCode/review` | `report.review` |
| GET | `/admin/reports/:reportCode/review-history` | `report.review` |
| POST | `/admin/reports/:reportCode/submissions` | `report.fulfill` |
| POST | `/admin/reports/:reportCode/proofs` | `report.fulfill` |
| PATCH | `/admin/reports/:reportCode/proofs/:proofId` | `report.fulfill` |
| POST | `/admin/reports/:reportCode/proofs/:proofId/void` | `report.fulfill` **+ step-up MFA** |
| POST | `/admin/reports/:reportCode/mark-partially-completed` | `report.fulfill` |
| POST | `/admin/reports/:reportCode/mark-completed` | `report.fulfill` |
| POST | `/admin/reports/:reportCode/mark-failed` | `report.fulfill` |
| POST | `/admin/reports/:reportCode/retry-submission` | `report.fulfill` |
| POST | `/admin/reports/:reportCode/archive` | `report.fulfill` |
| GET | `/admin/payments/review` | `payment.verify` |
| POST | `/admin/payments/:gatewayOrderId/resolve` | `payment.verify` |
| GET/POST | `/admin/reconciliations`, `/admin/reconciliations/run`, `/admin/reconciliations/:id/resolve` | `payment.verify` |
| GET | `/admin/notifications/stats`, `/admin/notifications/events` | `notification.manage` |
| POST | `/admin/notifications/events/:eventId/retry` | `notification.manage` |
| GET | `/admin/audit/logs`, `/admin/audit/verify-chain`, `/admin/audit/checkpoints` | `audit.read` |

---

## Webhook dan gateway simulasi

| Method | Endpoint | Akses |
|---|---|---|
| POST | `/webhooks/payments/:provider` | publik, tanda tangan HMAC |
| GET | `/mock-gateway/orders/:gatewayOrderId` | publik, hanya saat `PAYMENT_DRIVER=mock` |
| POST | `/mock-gateway/orders/:gatewayOrderId/pay` | idem |
| POST | `/mock-gateway/orders/:gatewayOrderId/replay` | idem — mengirim ulang webhook dengan `event_id` sama untuk menguji idempotency |

Bentuk webhook yang diterima:

```
POST /api/v1/webhooks/payments/mockpay
X-Signature: <hex HMAC-SHA256 atas "{timestamp}.{body mentah}">
X-Timestamp: <detik epoch>

{"event_id":"evt_…","order_id":"RPT-…-01","status":"PAID","amount":"333000",
 "payment_method":"VA_BNI","occurred_at":"2026-09-19T03:11:02.000Z"}
```

Tanda tangan dihitung atas **byte mentah** yang dikirim penyedia, bukan atas hasil serialisasi ulang. Selisih waktu lebih dari 5 menit ditolak.

---

## Kesehatan dan pengembangan

| Method | Endpoint | Akses |
|---|---|---|
| GET | `/health` | publik — liveness, tidak menyentuh dependensi |
| GET | `/health/ready` | publik — readiness: database, Redis, storage, fetcher |
| GET | `/dev/mailbox`, `/dev/mailbox/latest?to=` | publik, hanya saat `MAIL_DRIVER=mailbox` dan bukan production |

---

## Batas laju

| Jalur | Batas |
|---|---|
| Login | 5 per menit per akun + IP |
| Permintaan OTP | 3 per 10 menit |
| API umum | 120 per menit per pengguna |
| Unggah berkas | 30 per jam per pengguna |
| Webhook pembayaran | 600 per menit (penyedia dapat melakukan burst) |

Pelanggaran menghasilkan 429 beserta `details.retryAfterSeconds`.
