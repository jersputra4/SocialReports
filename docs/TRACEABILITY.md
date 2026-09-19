# Telusur Acceptance Criteria

Pemetaan AC-01 sampai AC-38 pada BRD/SRS v1.1 §11 ke tempat aturannya ditegakkan dan cara membuktikannya.

Kolom **Lapisan** menunjukkan di mana aturan dijaga:

* **DB** — constraint atau trigger database; berlaku walaupun kode aplikasi salah
* **API** — kode aplikasi
* **UI** — antarmuka; selalu berpasangan dengan penjagaan di API
* **Uji** — pengujian otomatis yang membuktikannya

---

## Autentikasi dan sesi

| AC | Ditegakkan di | Lapisan | Bukti |
|---|---|---|---|
| AC-01 Verifikasi email, token 24 jam sekali pakai, report terkunci sebelum verifikasi | `auth/auth.service.ts` (`register`, `verifyEmail`, `sendEmailVerification`); guard `EMAIL_VERIFIED` pada `reports/state-machine.ts` baris 1 | API | `state-machine.spec.ts` → prasyarat transisi |
| AC-02 Panjang kata sandi 10/12 dan daftar umum | `auth/password.policy.ts` | API, Uji | `password.policy.spec.ts` (8 skenario) |
| AC-03 Lockout 5 kegagalan, 15 menit, bertingkat | `auth/auth.service.ts` (`registerFailedLogin`); rate limit `common/security/rate-limit.guard.ts` | API | — |
| AC-04 Admin wajib OTP di semua environment; OTP 5 menit, sekali pakai, gugur setelah 5 salah | `auth/mfa.service.ts`; `auth.service.ts` (`mfaRequired = role.isStaff \|\| mfaEnabled`) | API | — |
| AC-05 Gagal start bila ada kata sandi bawaan; secret contoh ditolak | `auth/startup-security.check.ts` | API | — |
| AC-06 Logout dan idle timeout mencabut sesi di server | `common/security/session.service.ts`, `session.guard.ts` | API | — |
| AC-38 Step-up MFA untuk aksi sensitif | `common/security/step-up.guard.ts` + dekorator `@RequireStepUpMfa()` pada harga, PPN, master policy/legal, void bukti | API, UI | — |

## Kepemilikan objek dan identitas

| AC | Ditegakkan di | Lapisan | Bukti |
|---|---|---|---|
| AC-07 Objek milik orang lain menghasilkan 404 dan tercatat | `reports.service.ts` (`findForUser`, `resolveOwnedReport`), `evidences.service.ts`, `proofs.service.ts`, `documents.service.ts` — seluruhnya mencatat `ACCESS_DENIED` | API | — |
| AC-08 `report_code` berformat, unik, tidak berurutan | `common/utils/codes.util.ts`; constraint `reports_report_code_format` (migrasi 0003) | DB, API, Uji | `codes.util.spec.ts` — 2.000 kode diuji keunikan dan keacakan urutannya |
| AC-29 Signed URL ≤ 120 detik dan terikat pemanggil | `storage/storage.service.ts` (`SIGNED_URL_TTL_SECONDS` dibatasi maksimal 120 di `configuration.ts`) | API | — |

## Anti-SSRF

| AC | Ditegakkan di | Lapisan | Bukti |
|---|---|---|---|
| AC-09 Host di luar allowlist, IP privat/loopback/`169.254.169.254`, skema non-http(s), redirect ke IP internal ditolak; uji DNS rebinding lulus | `fetcher/src/ssrf-guard.ts` (bentuk URL + penyaringan IP), `fetcher/src/fetch-metadata.ts` (`pinnedLookup`) | API, Uji | `ssrf-guard.spec.ts` (14 kelompok); verifikasi langsung: layanan dijalankan dan sembilan vektor ditembakkan, termasuk domain allowlist yang resolve ke `127.0.0.1` |
| AC-10 Maksimal 3 redirect, timeout 5 detik, respons > 1 MB ditolak | `fetcher/src/fetch-metadata.ts` (`FETCH_LIMITS`) | API | `ssrf-guard.spec.ts` |

## Harga, PPN, dan pembayaran

| AC | Ditegakkan di | Lapisan | Bukti |
|---|---|---|---|
| AC-11 Total paket 300/500/1.000/1.500 dengan PPN 11% | `common/utils/money.util.ts`; nilai diambil dari `pricing_config`/`tax_config` lewat `pricing/pricing.service.ts` | API, Uji | `money.util.spec.ts` — tabel 6.2 dokumen diuji persis |
| AC-12 Perubahan harga/pajak tidak mengubah report berjalan | Trigger `reports_snapshot_immutable` (migrasi 0003, 0007) | DB, Uji | `db-integrity-test.sql` — perubahan harga snapshot ditolak; kuotasi ulang hanya diizinkan pada `EXPIRED`/`PAYMENT_REJECTED` |
| AC-13 PDF memakai snapshot, bukan master terkini | `documents/documents.service.ts` membaca kolom snapshot dan tabel `report_policies`/`report_legal_basis` | API | — |
| AC-14 Webhook valid → `SETTLED` + `PAID`; signature salah → 401 dan tercatat; redirect tidak mengubah status | `payments/payments.service.ts` (`receiveWebhook`, `processWebhookEvent`); halaman pembayaran tidak memanggil endpoint status apa pun | API | — |
| AC-15 10 webhook `provider_event_id` sama paralel → 1 transisi, 1 audit, tetap 200 | Unique `(provider, provider_event_id)` pada `webhook_events`; `SELECT … FOR UPDATE` pada `report-transition.service.ts` | DB, API, Uji | `db-integrity-test.sql` — penyisipan kedua ditolak unique constraint |
| AC-16 Order tidak dibayar 24 jam → `EXPIRED`, order baru dengan harga dihitung ulang | `payments.service.ts` (`expireOverduePayments`), `worker/scheduled-tasks.service.ts`, `payments/checkout.service.ts` (`retry`) | API | — |
| AC-17 Kurang bayar → `PAYMENT_REVIEW`; lebih bayar → `PAID` + `overpaid_amount`, tanpa refund | `payments.service.ts` (`processWebhookEvent`) | API, Uji | `state-machine.spec.ts` — tidak ada satu pun status atau transisi bernama refund |
| AC-18 Tombol bayar mati tanpa consent; API menolak; consent tersimpan dengan versi, waktu, IP | `payments/checkout.service.ts`; guard `NO_REFUND_CONSENT`; UI `NewReportPage.tsx` | API, UI, Uji | `state-machine.spec.ts` |
| AC-19 Selisih rekonsiliasi dibuat dan alert terkirim | `payments.service.ts` (`reconcile`), cron harian `scheduled-tasks.service.ts` | API | — |

## Unggahan berkas

| AC | Ditegakkan di | Lapisan | Bukti |
|---|---|---|---|
| AC-20 Bukan gambar valid / > 5 MB / ekstensi ganda ditolak; malware dikarantina; SHA-256 disimpan; EXIF dibuang | `common/utils/magic-bytes.util.ts`, `common/uploads/upload-pipeline.service.ts`, `common/uploads/malware-scanner.ts`; constraint ukuran pada `evidences` dan `report_completion_proofs` | DB, API, Uji | `magic-bytes.util.spec.ts` — HTML/SVG/PDF yang dinamai `.png` ditolak |

## Review dan siklus hidup

| AC | Ditegakkan di | Lapisan | Bukti |
|---|---|---|---|
| AC-21 Alasan review wajib ≥ 10 karakter, tercatat tiga tempat | `reports/review.service.ts`; constraint `review_decisions_reason_min_length` | DB, API, Uji | `db-integrity-test.sql`; `state-machine.spec.ts` |
| AC-22 `NEEDS_REVISION` → `WAITING_REVIEW` tanpa pembayaran baru | `reports/state-machine.ts` baris 16 — prasyaratnya tidak memuat `PAYMENT_ORDER_CREATED` | API, Uji | `state-machine.spec.ts` |
| AC-23 Transisi di luar tabel 7.2 → 409 dan tercatat; seluruh matriks diuji | `reports/state-machine.ts` + `common/filters/all-exceptions.filter.ts` (memetakan `TransitionNotAllowedError` → 409) | API, Uji | `state-machine.spec.ts` — **256 pasangan status** diuji satu per satu |
| AC-24 `APPROVED` → `SUBMITTED` hanya bila ada `complaint_submissions` | Guard `COMPLAINT_SUBMISSION`; `complaints/complaints.service.ts` menulis record dan transisi dalam satu transaksi | API, Uji | `state-machine.spec.ts` |

## Bukti Pengerjaan (BRD §8)

| AC | Ditegakkan di | Lapisan | Bukti |
|---|---|---|---|
| AC-25 Pemilik report melihat bukti; user lain tidak | `proofs/proofs.service.ts` (`listForUser`, `downloadUrl`) | API | — |
| AC-26 `COMPLETED` ditolak tanpa bukti aktif yang terlihat | Guard `ACTIVE_PROOF` **dan** trigger `reports_completed_requires_proof` (migrasi 0003) | DB, API, Uji | `db-integrity-test.sql` — ditolak sebelum ada bukti, berhasil setelahnya; `state-machine.spec.ts` |
| AC-27 Void menyembunyikan dari user, tetap terlihat admin, tanpa hard delete, tercatat, menuntut step-up MFA | `proofs/proofs.service.ts` (`void`); `@RequireStepUpMfa()` pada endpointnya; constraint `proofs_void_needs_reason` | DB, API, UI | `db-integrity-test.sql` — void tanpa alasan ditolak |
| AC-28 User mencoba unggah/ubah/void → 403 | Endpoint proof admin menuntut izin `report.fulfill`; `PermissionsGuard` | API | — |

## Notifikasi

| AC | Ditegakkan di | Lapisan | Bukti |
|---|---|---|---|
| AC-30 n8n mati → event tersimpan di outbox dan terkirim setelah pulih; retry eksponensial maksimal 8 lalu DLQ; retry manual; tanpa duplikat | `notifications/outbox.service.ts` (tulis dalam transaksi yang sama), `worker/outbox-dispatcher.service.ts` (backoff 1…128 menit) | API | Verifikasi langsung: simulator dijalankan, event duplikat dibalas `duplicate: true` tanpa fan-out kedua |
| AC-31 Payload tanpa URL target/evidence/nama/email; webhook ditolak tanpa HMAC valid atau timestamp > 5 menit | `notifications/outbox.service.ts` (`OutboxPayload` hanya enam field), `automation/src/index.ts` | API | Verifikasi langsung: tanda tangan salah → 401, timestamp 1 jam lalu → 401, tanpa header → 401 |
| AC-32 `PROOF_UPLOADED` dan `REPORT_COMPLETED` mengirim email ke user | `worker/outbox-dispatcher.service.ts` (`USER_EMAIL_EVENTS`) | API | — |

## Audit dan dokumen

| AC | Ditegakkan di | Lapisan | Bukti |
|---|---|---|---|
| AC-33 Aksi kritis tercatat; `UPDATE`/`DELETE` gagal; verifikasi hash harian lulus; perubahan satu baris terdeteksi | Trigger `audit_logs_chain`, `audit_logs_no_update/delete/truncate`, fungsi `audit_verify_chain` (migrasi 0002) | DB, Uji | `db-integrity-test.sql` — trigger sengaja dimatikan, satu baris diubah, verifikasi menemukannya |
| AC-34 PDF memuat rincian harga, snapshot, evidence, lampiran bukti opsional; asinkron; versi baru tidak menimpa; hash tersimpan; tanpa request jaringan keluar | `documents/report-pdf.builder.ts` (pdfmake berbasis template, bukan render HTML), `documents.service.ts` | API | — |
| AC-35 Payload skrip pada teks bebas tidak dieksekusi di UI dan PDF | React meng-escape bawaan; `common/utils/sanitize.util.ts` untuk email HTML dan PDF; CSP pada `frontend/nginx.conf` | API, UI | — |

## Beban dan pemulihan

| AC | Status | Catatan |
|---|---|---|
| AC-36 Profil beban NFR-01…05, failover DB dengan RTO ≤ 4 jam, RPO ≤ 15 menit | **Belum diuji** | Compose menjalankan PostgreSQL instance tunggal untuk pengembangan. WAL archiving sudah diaktifkan; replica, Patroni, dan load test perlu disiapkan di lingkungan nyata |
| AC-37 Restore drill database, evidence, bukti, dan PDF dengan hash cocok | **Belum diuji** | Hash setiap berkas sudah disimpan (`file_hash`), sehingga pencocokan setelah restore dapat dilakukan; prosedur drill-nya belum ditulis |

---

## Ringkasan pengujian otomatis

| Berkas | Jumlah pemeriksaan | Yang dibuktikan |
|---|---|---|
| `scripts/db-integrity-test.sql` | 33 | Jaminan lapisan database terhadap PostgreSQL sungguhan |
| `backend/src/reports/state-machine.spec.ts` | 18 | Seluruh 256 pasangan status, kewenangan aktor, prasyarat, alasan wajib |
| `backend/src/common/utils/money.util.spec.ts` | 8 | Tabel harga dokumen, pembulatan half-up, bebas galat floating point |
| `backend/src/common/utils/codes.util.spec.ts` | 7 | Format, keunikan, dan keacakan kode report |
| `backend/src/common/utils/magic-bytes.util.spec.ts` | 9 | Deteksi jenis berkas dari isi, sanitasi nama |
| `backend/src/auth/password.policy.spec.ts` | 8 | Kebijakan kata sandi |
| `fetcher/src/ssrf-guard.spec.ts` | 14 | Seluruh vektor SSRF pada BRD §4.2 |
