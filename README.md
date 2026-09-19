# Sistem Pelaporan Konten Media Sosial

Implementasi dari **BRD/SRS v1.1 — Arsitektur Ulang & Revisi Sistem Pelaporan Konten Media Sosial**.

Sistem membantu pengguna **membuat, mendokumentasikan, dan memantau laporan** terhadap konten atau akun di Facebook, Instagram, TikTok, X, dan YouTube. Sistem **tidak** menurunkan konten atau akun — keputusan itu sepenuhnya ada pada platform terkait. Yang dibuktikan sistem ini adalah bahwa laporan benar-benar dikerjakan, lewat fitur **Bukti Pengerjaan**.

---

## Menjalankan di komputer sendiri

### Prasyarat

* Docker dan Docker Compose v2
* Port bebas: 8080 (aplikasi), 55432 (PostgreSQL), 56379 (Redis), 59000/59001 (MinIO)

### Tiga perintah

```bash
cp .env.example .env
docker compose up -d --build
docker compose run --rm migrate
```

Atau cukup `make up`, yang menjalankan ketiganya sekaligus.

Aplikasi siap di **<http://localhost:8080>**.

Perintah `migrate` menjalankan migrasi database lalu mengisi data awal: izin, role, jenis tindakan, paket, harga Rp1.000/unit, PPN 11%, lima platform beserta kebijakannya, dan tiga dasar hukum. Di lingkungan non-production perintah itu juga membuat empat akun demo dan **mencetak kata sandinya sekali ke layar** — tidak ada kredensial yang ditulis di kode maupun dokumen.

```
┌─────────────────────────────────────────────────────────────────────┐
│ AKUN DEMO — kata sandi ini hanya ditampilkan SEKALI                 │
└─────────────────────────────────────────────────────────────────────┘
 user      pengguna@contoh.test       hujan-cemara-pasir-4821
 admin     admin@contoh.test          kopi-senja-elang-7134
 reviewer  reviewer@contoh.test       kabut-bambu-rusa-2056
 finance   finance@contoh.test        anggrek-pelabuhan-gerimis-9317
```

Akun internal (admin, reviewer, finance) **wajib memasukkan kode OTP** setiap kali masuk. Karena pada pengembangan tidak ada penyedia email sungguhan, seluruh email — termasuk OTP — masuk ke kotak masuk lokal di **<http://localhost:8080/dev/mailbox>**.

### Menjalankan tanpa Docker

Butuh PostgreSQL 16, Redis 7, dan object storage S3-compatible yang berjalan sendiri.

```bash
# backend
cd backend
npm install
npx prisma migrate deploy
npm run seed
npm run start:dev          # API pada :3000
npm run worker:dev         # worker, di terminal lain

# layanan pendamping
cd ../fetcher     && npm install && npm run start:dev    # :4001
cd ../automation  && npm install && npm run start:dev    # :4002

# frontend
cd ../frontend && npm install && npm run dev             # :5173
```

---

## Mencoba alur lengkap

Urutan di bawah menelusuri seluruh siklus hidup report, dari draf sampai selesai dengan bukti pengerjaan.

1. **Masuk sebagai pengguna** (`pengguna@contoh.test`).
2. **Buat report** — tempelkan tautan konten, mis. `https://x.com/contoh/status/1234567890`. Pilih paket, kebijakan yang dilanggar, dasar hukum, lalu unggah tangkapan layar sebagai evidence.
3. **Setujui ketentuan tanpa refund** lalu buat tagihan. Anda diarahkan ke halaman pembayaran.
4. **Bayar**. Halaman itu adalah gateway simulasi; ia mengirim webhook bertanda tangan ke backend persis seperti penyedia sungguhan.
   * Tombol **"Isi setengah"** mencoba jalur kurang bayar → report masuk `PAYMENT_REVIEW` dan menunggu keputusan Finance.
   * Tombol **"Lebihkan 50 ribu"** mencoba jalur lebih bayar → report menjadi `PAID`, kelebihan dicatat dan tidak dikembalikan.
5. **Masuk sebagai reviewer**, buka antrean review, lalu putuskan: setujui, minta perbaikan, atau tolak. Alasan wajib minimal 10 karakter.
6. **Masuk sebagai admin**, catat pelaporan ke platform (kanal, waktu, nomor acuan). Report berpindah ke `SUBMITTED`.
7. **Unggah bukti pengerjaan** — tangkapan layar bahwa postingan atau akun sudah dilaporkan. Isi jumlah unit tercakup bila ingin mencoba status `PARTIALLY_COMPLETED`.
8. **Tandai selesai**. Sistem menolak bila belum ada bukti aktif yang terlihat pengguna — ditolak aplikasi *dan* ditolak trigger database.
9. **Kembali sebagai pengguna**, buka tab **Bukti Pengerjaan** pada detail report, lalu buat **PDF dengan lampiran bukti**.

Sepanjang alur itu, setiap perubahan tercatat di audit log. Buka **Admin → Audit log** dan tekan *Verifikasi ulang rantai hash*.

---

## Arsitektur

Zona jaringan mengikuti BRD §3.2; `docker-compose.yml` menegakkannya lewat keanggotaan network, bukan sekadar catatan.

```
                         INTERNET
                            │
              nginx  (zona Public/DMZ, satu-satunya yang terbuka)
                            │
        ┌───────────────────┴───────────────────┐
        │                                       │
   frontend (statis)                    api (NestJS, stateless)
                                                │
        ┌───────────────┬───────────────────────┼──────────────────┐
        │               │                       │                  │
   PostgreSQL        Redis             MinIO (S3-compatible)      worker
   primary           queue/cache       privat, terenkripsi,       (BullMQ +
   + WAL archiving                     versioning                 penjadwal)
        └──────────── zona Data (tidak tersambung ke fetcher/n8n) ──┘

   fetcher   (zona Restricted egress — satu-satunya yang menghubungi URL target;
              TIDAK punya jalur ke zona Data)
   automation(zona Automation — pengganti n8n; TIDAK punya jalur ke zona Data)
```

### Mengapa dipisah begitu

* **Metadata Fetcher terpisah.** Ia satu-satunya komponen yang membuka koneksi ke URL yang diberikan pengguna. Bila ada kelemahan di sana, yang terpapar hanya proses itu — dan proses itu tidak punya jalur jaringan ke database maupun object storage.
* **Worker terpisah dari API.** Render PDF, pemindaian berkas, dan pengiriman notifikasi tidak ikut memperlambat permintaan pengguna (NFR-01, NFR-02).
* **n8n tidak memegang keputusan.** Ia hanya menerima event dan menyebarkannya ke kanal admin. OTP dikirim backend langsung ke penyedia email, sehingga proses masuk tidak bergantung pada n8n.

---

## Keputusan rancangan yang perlu diketahui

### Rantai hash audit dihitung di database, bukan di aplikasi

`entry_hash = SHA-256(prev_hash || canonical(entry))` dihitung oleh trigger `BEFORE INSERT` pada `audit_logs` (migrasi `0002`). Konsekuensinya rantai tetap benar walaupun ada beberapa instance API yang menulis bersamaan, dan kebenarannya tidak bergantung pada kode aplikasi. `UPDATE` dan `DELETE` diblokir trigger — berlaku untuk semua role, termasuk pemilik tabel.

### Snapshot dibekukan trigger, bukan hanya oleh kode

Setelah `snapshot_sealed_at` terisi, kolom harga, PPN, kebijakan, dasar hukum, dan target tidak dapat diubah (migrasi `0003`).

**Pengecualian yang disengaja.** Dokumen punya dua aturan yang berbenturan: §6.2 membekukan snapshot setelah `WAITING_PAYMENT`, sedangkan §7.2 baris 9–10 menyebut harga dihitung ulang ketika pengguna membuat tagihan baru setelah kedaluwarsa atau pembayaran ditolak. Keduanya berdamai bila pembekuan dibaca sebagai *"report yang sedang berjalan tidak berubah karena perubahan konfigurasi"*. Karena itu trigger melepas penguncian **hanya** pada status `EXPIRED` dan `PAYMENT_REJECTED` (migrasi `0007`); di status lain snapshot tetap tidak dapat disentuh, dan setiap penguotaan ulang tercatat di audit log.

### Sesi server-side opaque, bukan JWT

Token di cookie hanyalah nilai acak; keadaannya ada di tabel `user_sessions`. Karena itu sesi dapat dicabut seketika — hal yang tidak mungkin pada JWT tanpa daftar cabut terpisah. Redis hanya cache pembacaan.

### Uang memakai BigInt

Seluruh nilai uang adalah bilangan bulat rupiah (`bigint` di database, `BigInt` di TypeScript). API mengirimkannya sebagai **string** karena JSON tidak mengenal BigInt; frontend memformatnya tanpa pernah mengubahnya menjadi `Number`.

### Primary key UUID v7

Fungsi database `uuid_generate_v7()` (migrasi `0005`) menghasilkan kunci terurut waktu sehingga index tidak terfragmentasi ketika tabel report dan audit tumbuh, tanpa mengorbankan ketidakterkaan. Identitas publik memakai `report_code` acak yang terpisah.

---

## Yang disimulasikan, dan cara menggantinya

Tiga ketergantungan luar tidak dapat dipanggil sungguhan di komputer sendiri. Semuanya berada di balik antarmuka, sehingga penggantian tidak menyentuh alur bisnis.

| Ketergantungan | Simulasi lokal | Cara mengganti |
|---|---|---|
| Payment gateway | `PAYMENT_DRIVER=mock` — halaman checkout, webhook HMAC, endpoint status server-to-server | Tulis kelas yang memenuhi `PaymentGateway` (`backend/src/payments/gateway/payment-gateway.interface.ts`), daftarkan di `payments.module.ts`, ubah `PAYMENT_DRIVER` |
| Email transaksional | `MAIL_DRIVER=mailbox` — email masuk tabel `dev_mailbox`, dibaca di `/dev/mailbox` | `MAIL_DRIVER=smtp` lalu isi `SMTP_*` |
| n8n | layanan `automation` — verifikasi HMAC, dedupe `event_id`, fan-out kanal | Arahkan `N8N_WEBHOOK_URL` ke n8n sungguhan; impor `n8n/workflows/report-events.json` |
| Antivirus | `MALWARE_SCANNER=mock` — deteksi EICAR dan polyglot gambar/HTML | `MALWARE_SCANNER=clamav` lalu isi `CLAMAV_HOST` |

Yang **tidak** disimulasikan dan berjalan sungguhan: tanda tangan HMAC, deduplikasi idempoten, konfirmasi server-to-server, rantai hash audit, pembekuan snapshot, proteksi SSRF, pembuangan EXIF, dan seluruh state machine.

---

## Pengujian

```bash
# Uji integritas database terhadap PostgreSQL yang berjalan
docker compose exec -T postgres psql -U srs -d social_report -v ON_ERROR_STOP=1 \
  < scripts/db-integrity-test.sql

# Uji unit logika bisnis
cd backend  && npm test
cd ../fetcher && npm test

# Smoke test end-to-end terhadap stack yang berjalan
node scripts/smoke-test.mjs

# Verifikasi rantai hash audit dari luar aplikasi
docker compose exec api node dist/cli/verify-audit-chain.js
```

`scripts/db-integrity-test.sql` menjalankan 33 pemeriksaan terhadap database sungguhan: audit append-only, deteksi perubahan baris, pembekuan snapshot, penolakan `COMPLETED` tanpa bukti, rentang tarif yang tumpang tindih, deduplikasi webhook, dan lainnya. Seluruhnya berjalan dalam satu transaksi yang di-rollback, jadi aman dijalankan kapan pun.

---

## Struktur proyek

```
social-report-system/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma          model data (BRD §5)
│   │   ├── migrations/            0001 skema · 0002 audit append-only + hash chain
│   │   │                          0003 aturan bisnis · 0004 hak akses role
│   │   │                          0005 UUID v7 · 0006 nomor invoice · 0007 kuotasi ulang
│   │   └── seed.ts                data master + akun demo
│   ├── src/
│   │   ├── auth/                  MFA, sesi, lockout, kebijakan kata sandi
│   │   ├── reports/               state machine 24 transisi, snapshot, review
│   │   ├── payments/              gateway, webhook, rekonsiliasi, checkout
│   │   ├── proofs/                Bukti Pengerjaan (BRD §8)
│   │   ├── evidences/  documents/ unggahan dan PDF berversi
│   │   ├── notifications/         transactional outbox
│   │   ├── pricing/ policies/ legal/ platforms/   master data
│   │   ├── audit/                 pembacaan audit log
│   │   ├── worker/                BullMQ + pekerjaan terjadwal
│   │   └── common/                konfigurasi, keamanan, unggahan, antrean, audit
│   └── cli/                       create-admin, verify-audit-chain
├── fetcher/                       Metadata Fetcher terisolasi (anti-SSRF)
├── automation/                    simulator n8n
├── frontend/                      React + Vite + TypeScript + Tailwind
├── infrastructure/nginx/          reverse proxy zona publik
├── n8n/workflows/                 alur n8n siap impor
├── scripts/                       uji integritas DB, smoke test
└── docs/                          API, keamanan, SOP admin, telusur AC
```

---

## Dokumentasi lanjutan

| Berkas | Isi |
|---|---|
| [`docs/API.md`](docs/API.md) | Seluruh endpoint, izin yang dituntut, dan contoh permintaan |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Model ancaman, kontrol yang dipasang, dan yang sengaja belum dipasang |
| [`docs/TRACEABILITY.md`](docs/TRACEABILITY.md) | Pemetaan AC-01 … AC-38 ke berkas dan pengujiannya |
| [`docs/SOP.md`](docs/SOP.md) | Panduan kerja admin operasional, reviewer, dan Finance |
| [`docs/ERD.md`](docs/ERD.md) | Relasi antar tabel |

---

## Yang belum dikerjakan

Daftar ini jujur dan sengaja: butir-butir berikut ada di dokumen tetapi belum masuk implementasi ini, dan perlu diputuskan sebelum go-live.

* **Gate Phase 0** pada BRD §12.4 — kontrak payment gateway, konfirmasi status PKP dan faktur pajak, domain email pengirim dengan SPF/DKIM/DMARC, serta review legal atas klausul tanpa refund (R-08). Sistem menyiapkan tempatnya; keputusannya bukan keputusan teknis.
* **Verifikasi jalur pelaporan resmi tiap platform** (A2) — kanal pelaporan dicatat sebagai data, tetapi daftar kanal yang sah per platform perlu ditetapkan operasional.
* **Kontrol penyalahgunaan** (A3) — verifikasi identitas pelapor, standing pelapor, dan dedupe target belum ada.
* **Maker-checker untuk master data** (B9) — pemisahan tugas sudah dimungkinkan lewat izin terpisah, tetapi alur persetujuan dua orang belum dibuat.
* **Penguatan keaslian evidence** (B10) — arsip halaman, timestamp tepercaya, dan tanda tangan elektronik pada PDF belum ada.
* **TOTP/WebAuthn** — MFA saat ini lewat email, dengan kelemahan yang sudah dicatat dokumen: keamanannya mengikuti keamanan mailbox.
* **Kebijakan backup dan retensi** (D20, NFR-13) — WAL archiving disiapkan di compose, tetapi jadwal, lokasi terpisah, dan latihan restore belum ditetapkan.
* **Prometheus/Grafana dan Loki** — metrik dan alert NFR-11 belum dipasang; yang ada baru endpoint `/health/ready` dan statistik outbox.
* **Replica PostgreSQL dan Sentinel Redis** — compose menjalankan instance tunggal untuk pengembangan; NFR-06 menuntut failover otomatis di produksi.

---

## Catatan kepatuhan

Sistem ini membuat dan mendokumentasikan laporan. Sistem tidak menurunkan konten, tidak menjamin platform akan menindaklanjuti, dan tidak menetapkan bahwa suatu konten pasti melanggar hukum. Pemilihan dasar hukum adalah dokumentasi argumen pelapor, bukan putusan. Seluruh antarmuka menyatakan batas ini secara eksplisit kepada pengguna.
