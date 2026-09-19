# Relasi Antar Tabel

Mengacu BRD/SRS v1.1 §5.3, dengan tambahan tabel yang dibutuhkan implementasi.

```
┌─ Auth ────────────────────────────────────────────────────────────────┐
│  roles ──< role_permissions >── permissions                           │
│    │                                                                   │
│    └──< users ──< user_sessions                                        │
│              ├──< password_resets                                      │
│              ├──< email_verifications                                  │
│              ├──< mfa_challenges                                       │
│              └──< user_consents ──> reports (opsional)                 │
└────────────────────────────────────────────────────────────────────────┘

┌─ Master ──────────────────────────────────────────────────────────────┐
│  social_platforms ──< platform_policies ──< platform_policy_versions  │
│  laws ──< legal_versions ──< legal_articles ──< legal_paragraphs      │
│    └──< legal_amendments                                               │
│  action_types      packages      payment_methods                      │
│  pricing_config    tax_config    (berbasis rentang tanggal)           │
└────────────────────────────────────────────────────────────────────────┘

┌─ Report ──────────────────────────────────────────────────────────────┐
│  target_snapshots >── reports ──< report_status_history               │
│                          ├──< report_policies ──> platform_policy_versions
│                          ├──< report_legal_basis ──> legal_paragraphs │
│                          ├──< evidences                                │
│                          ├──< report_documents      (PDF berversi)     │
│                          ├──< report_completion_proofs                 │
│                          ├──< review_decisions                         │
│                          ├──< complaint_submissions                    │
│                          ├──< invoices                                 │
│                          ├──< payments ──< payment_transactions        │
│                          │             ├──< payment_verifications      │
│                          │             └──< payment_reconciliations    │
│                          └──< outbox_events ──< notification_logs      │
│  reports >── action_types, packages                                    │
└────────────────────────────────────────────────────────────────────────┘

┌─ Lain ────────────────────────────────────────────────────────────────┐
│  webhook_events      (unique provider + provider_event_id)            │
│  idempotency_keys                                                      │
│  audit_logs ── append-only, berantai hash                             │
│  audit_checkpoints   (hash harian, diekspor ke object storage WORM)   │
│  dev_mailbox         (kotak masuk email lokal saat pengembangan)      │
└────────────────────────────────────────────────────────────────────────┘
```

## Catatan rancangan

**Snapshot ada di dua tempat, dan itu disengaja.** Tabel `reports` menyimpan snapshot *utama* (kebijakan dan dasar hukum pertama) untuk kebutuhan tampilan cepat dan constraint kelengkapan, sedangkan `report_policies` dan `report_legal_basis` menyimpan **seluruh** pilihan beserta salinan teksnya. Dokumen PDF dan halaman detail membaca tabel rinci itu; kolom snapshot di `reports` dipakai untuk daftar, pencarian, dan pemeriksaan constraint.

**`target_snapshots` terpisah dari `reports`** karena satu target dapat dipakai ulang ketika pengguna memperbaiki report, dan karena isinya adalah hasil pengambilan data luar yang mungkin gagal — statusnya (`OK`, `PARTIAL`, `FAILED`, `MANUAL`) perlu tercatat sendiri.

**`payments` dapat lebih dari satu per report.** Order yang kedaluwarsa atau ditolak tetap tersimpan; order baru dibuat dengan `gateway_order_id` bernomor urut (`RPT-XXXXXXXXXX-02`). Partial unique index memastikan hanya ada satu order aktif pada satu waktu.

**`outbox_events` merujuk report secara opsional** (`ON DELETE SET NULL`) supaya event sistem yang tidak terkait report tertentu tetap dapat ditulis.

**`audit_logs` tidak punya foreign key ke `users`.** Audit harus tetap utuh walaupun akun dihapus di kemudian hari; `actor_id` disimpan sebagai nilai apa adanya.

## Constraint yang menegakkan aturan bisnis

| Constraint | Aturan yang dijaga |
|---|---|
| `reports_report_code_format` | Format `RPT-` + 10 karakter Crockford base32 |
| `reports_snapshot_complete` | Report di luar `DRAFT`/`CANCELLED` wajib punya snapshot lengkap |
| `reports_total_equals_subtotal_plus_tax` | Aritmetika harga tidak dapat menyimpang |
| `reports_snapshot_immutable` (trigger) | Snapshot beku, kecuali saat `EXPIRED`/`PAYMENT_REJECTED` |
| `reports_completed_requires_proof` (trigger) | `COMPLETED` menuntut minimal satu bukti aktif yang terlihat |
| `tax_config_no_overlap`, `pricing_config_no_overlap` | Tepat satu tarif dan satu harga berlaku pada satu waktu |
| `payments_one_active_per_report` | Hanya satu tagihan aktif per report |
| `payments_total_equals_subtotal_plus_tax` | Aritmetika tagihan konsisten |
| `webhook_events_provider_provider_event_id_key` | Deduplikasi webhook |
| `proofs_void_needs_reason` | Void selalu disertai alasan dan pelakunya |
| `proofs_reported_at_guard` (trigger) | Waktu pelaporan tidak di masa depan |
| `review_decisions_reason_min_length` | Alasan review minimal 10 karakter |
| `audit_logs_chain` + `audit_logs_no_update/delete/truncate` (trigger) | Audit append-only dan berantai hash |
