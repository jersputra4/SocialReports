# Keamanan

Dokumen ini menjelaskan ancaman yang diperhitungkan, kontrol yang dipasang untuk masing-masing, dan — sama pentingnya — apa yang **belum** dipasang.

---

## 1. Kredensial dan akun awal (BRD §4.1)

Tidak ada kredensial di dalam kode, dokumen, maupun berkas contoh environment.

* Akun admin pertama dibuat lewat `node dist/cli/create-admin.js <email>`. Kata sandi 32 karakter acak dibuat di sana, dicetak sekali, lalu tidak pernah ditampilkan lagi. Akunnya ditandai wajib ganti kata sandi pada login pertama dan MFA-nya langsung aktif.
* Akun demo hanya dibuat di luar production, juga dengan kata sandi acak yang dicetak sekali.
* `StartupSecurityCheck` menghentikan aplikasi di production bila ada akun internal berkata sandi umum/bawaan, atau ada secret yang masih memakai nilai contoh (`dev_only`, `change_me`) atau lebih pendek dari 32 karakter.

Yang **belum**: secret scanning di CI (mis. gitleaks) belum disiapkan karena berkasnya bergantung pada platform CI yang dipakai.

---

## 2. SSRF (BRD §4.2)

Pengambilan metadata adalah satu-satunya tempat sistem membuka koneksi ke alamat yang ditentukan pengguna. Perlakuannya berlapis:

1. **Isolasi proses.** Layanan `fetcher` berjalan terpisah dan tidak tersambung ke network zona Data. Walaupun ia sepenuhnya dikuasai penyerang, database dan object storage tetap di luar jangkauannya.
2. **Allowlist domain.** Hanya domain platform yang didukung. Sufiks palsu seperti `instagram.com.penyerang.id` ditolak karena pencocokan dilakukan per label domain.
3. **Bentuk URL.** Hanya `http`/`https`, port 80/443, tanpa userinfo. Alamat IP literal ditolak, termasuk bentuk numerik seperti `2130706433` dan `0x7f000001`.
4. **Penyaringan alamat IP.** Loopback, RFC1918, CGNAT, link-local (termasuk `169.254.169.254`), multicast, dan rentang reserved ditolak — juga bentuk IPv6-nya, termasuk IPv4-mapped `::ffff:127.0.0.1` dan NAT64 `64:ff9b::/96`.
5. **DNS pinning.** Resolusi dilakukan sendiri, hasilnya disaring, lalu koneksi dibuat ke alamat yang sudah lolos itu. Tidak ada jeda antara pemeriksaan dan koneksi, sehingga DNS rebinding tidak punya celah.
6. **Batas.** Maksimal 3 redirect (setiap tujuan divalidasi ulang dengan aturan yang sama), timeout 5 detik, respons maksimal 1 MB, content-type terbatas.
7. **Tanpa kredensial.** Tidak ada cookie, tidak ada header autentikasi, User-Agent tetap dan jelas.

**Pembuatan PDF** memakai pdfmake dengan definisi dokumen terstruktur — tidak ada mesin peramban yang merender masukan pengguna, sehingga jalur SSRF lewat pembuatan PDF tidak ada sejak awal. Gambar bukti disisipkan sebagai `data:` URI dari object storage internal.

Verifikasi: `fetcher/src/ssrf-guard.spec.ts`, dan pengujian langsung terhadap layanan yang berjalan.

---

## 3. Autentikasi, MFA, dan sesi (BRD §4.3)

| Kontrol | Nilai |
|---|---|
| Hash kata sandi | argon2id, 19 MiB, 2 iterasi, paralelisme 1 |
| Panjang minimum | 10 karakter (pengguna), 12 karakter (internal) |
| Daftar larangan | kata sandi umum, varian berangka, substitusi karakter (`p4ssw0rd`), potongan email dan nama sendiri |
| Lockout | 5 kegagalan berturut-turut → 15 menit, menggandakan tiap tingkat hingga 24 jam |
| OTP | 6 digit CSPRNG, berlaku 5 menit, disimpan sebagai hash, sekali pakai, gugur setelah 5 salah |
| Pengikatan OTP | terikat satu challenge **dan** satu peramban, lewat cookie `srs_mfa` berisi nilai acak yang di-hash di basis data |
| Kirim ulang | jeda 60 detik, maksimal 3 per 10 menit, dihitung dari tabel challenge (bukan dari Redis) |
| Sesi | opaque server-side, cookie HttpOnly/Secure/SameSite=Lax |
| Idle / absolut | 30 menit / 12 jam (pengguna); 15 menit / 8 jam (internal) |
| CSRF | double submit token pada seluruh permintaan yang mengubah data |
| Step-up MFA | OTP ulang ≤ 10 menit untuk ubah harga/PPN, ubah master policy/legal, dan void bukti pengerjaan |

**Kelemahan yang diakui dokumen dan tetap berlaku:** MFA lewat email hanya sekuat keamanan mailbox. Karena alamat email tidak dapat diubah sendiri oleh pengguna, mailbox akun internal wajib memakai domain perusahaan dengan MFA sendiri. TOTP/WebAuthn adalah peningkatan berikutnya dan belum ada di implementasi ini.

**Penolakan enumerasi akun:** pendaftaran dan permintaan reset kata sandi selalu menjawab hal yang sama. Login terhadap email yang tidak ada tetap menjalankan satu verifikasi argon2 palsu supaya waktu responsnya mirip.

---

## 4. Integritas audit (BRD §4.5)

* `audit_logs` append-only. `UPDATE`, `DELETE`, dan `TRUNCATE` ditolak trigger — berlaku untuk semua role, termasuk pemilik tabel. Role aplikasi `srs_app` bahkan tidak diberi hak itu.
* Rantai hash `entry_hash = SHA-256(prev_hash || canonical(entry))` dihitung trigger `BEFORE INSERT` dengan advisory lock, bukan oleh aplikasi. Beberapa instance API yang menulis bersamaan tetap menghasilkan rantai yang benar.
* `audit_verify_chain()` memeriksa seluruh rantai dan menunjuk baris pertama yang rusak. Dijalankan job harian, dapat dipanggil admin lewat UI, dan tersedia sebagai CLI di luar aplikasi.
* Hash terakhir tiap hari diekspor ke object storage sebagai checkpoint. Di lingkungan nyata bucket checkpoint dikunci Object Lock (WORM) sehingga pembanding berada di luar jangkauan pihak yang dapat menulis ke database.
* Nilai sensitif (kata sandi, token, OTP, secret, tanda tangan, payload mentah) diganti `[redacted]` sebelum ditulis.
* Pembacaan audit log dibatasi izin `audit.read` dan pembacaannya sendiri dicatat sebagai `AUDIT_LOG_VIEW`.

Dibuktikan: `scripts/db-integrity-test.sql` mematikan trigger, mengubah satu baris secara langsung, lalu memastikan verifikasi menemukannya.

---

## 5. Kepemilikan objek

* Seluruh akses objek diperiksa di backend. Objek milik orang lain menghasilkan **404**, bukan 403, sehingga keberadaannya tidak dapat dipetakan lewat tebakan; percobaan itu dicatat sebagai `ACCESS_DENIED`.
* Identitas publik memakai `report_code` acak 10 karakter Crockford base32 dengan karakter cek — sekitar 2,8 × 10¹³ kemungkinan, sehingga enumerasi tidak praktis.
* Berkas tidak pernah dilayani langsung. Akses memakai signed URL berumur maksimal 120 detik yang dibuat hanya setelah kepemilikan diperiksa.

---

## 6. Unggahan berkas

Pipeline yang sama untuk evidence dan bukti pengerjaan:

1. batas ukuran diperiksa lebih dulu;
2. jenis berkas ditentukan dari **magic bytes**, bukan dari nama atau content-type kiriman klien — HTML, SVG, PDF, dan executable yang dinamai `.png` semuanya ditolak;
3. nama berkas dibersihkan; ekstensi ganda ditolak;
4. gambar **di-encode ulang**, yang sekaligus membuang EXIF/GPS dan byte asing yang menempel di luar struktur gambar;
5. SHA-256 dihitung atas byte hasil encode ulang, yaitu byte yang benar-benar disimpan;
6. pemindaian malware dijalankan atas byte yang sama;
7. berkas yang tidak lolos **tidak pernah disimpan**.

Bucket bersifat privat dan terenkripsi sisi server, dengan versioning aktif.

---

## 7. Notifikasi (BRD §4.4)

* Event ditulis ke `outbox_events` dalam transaksi yang sama dengan perubahan datanya. Tidak mungkin terjadi "status berubah tetapi notifikasi hilang" atau sebaliknya.
* Payload sengaja minimal: `event_id`, `event_type`, `report_code`, `status`, `occurred_at`, dan tautan yang tetap menuntut login. Tidak ada URL target, isi evidence, nama, email, atau nomor telepon — karena kanal WhatsApp dan Telegram berada di luar kendali sistem ini.
* Webhook ke n8n ditandatangani HMAC-SHA256 atas `timestamp + "." + body`; penerima menolak tanda tangan yang salah maupun selisih waktu lebih dari 5 menit, dan melakukan deduplikasi berdasarkan `event_id`.
* Retry eksponensial 1…128 menit, maksimal 8 percobaan, lalu masuk dead-letter queue yang tampil di dashboard admin. Setiap percobaan ulang manual dicatat di audit log.
* n8n berada di zona Automation tanpa jalur ke database maupun object storage.

---

## 8. Pembayaran

* Tanda tangan webhook diperiksa atas body mentah sebelum apa pun dikerjakan; tanda tangan tidak valid menghasilkan 401 dan tercatat.
* Deduplikasi lewat unique `(provider, provider_event_id)`. Sepuluh webhook identik yang datang bersamaan hanya menghasilkan satu transisi.
* Status webhook **tidak pernah dipercaya sendirian**: status dikonfirmasi ulang ke gateway lewat panggilan server-to-server sebelum status report berubah.
* Halaman redirect "sukses" tidak memanggil endpoint apa pun yang mengubah status.
* Baris report dikunci `SELECT … FOR UPDATE` selama transisi, sehingga permintaan bersamaan tidak menghasilkan dua transisi dari status yang sama.
* Rekonsiliasi harian membandingkan laporan gateway dengan tabel `payments` dan mencatat selisihnya.

---

## 9. XSS dan header

* React meng-escape teks bawaan. Jalur yang tidak melewati React — email HTML dan PDF — memakai `escapeHtml` dan `sanitizeForPdf` (yang juga membuang karakter pembalik arah yang dapat menyamarkan isi tulisan).
* CSP ketat pada penyaji frontend: tidak ada skrip dari luar, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`.
* `helmet` pada API, `X-Content-Type-Options: nosniff`, dan `Content-Disposition: attachment` pada seluruh objek storage sehingga berkas tidak pernah dirender sebagai halaman.

---

## 10. Yang sengaja belum dipasang

Bersikap jujur soal ini lebih berguna daripada daftar kontrol yang terlihat lengkap.

| Butir | Alasan |
|---|---|
| TOTP/WebAuthn | Dokumen menempatkannya sebagai peningkatan berikutnya; MFA email sudah memenuhi lingkup v1.1 |
| Secret scanning CI | Bergantung pada platform CI yang belum ditentukan |
| ClamAV sungguhan | Titik sambungnya sudah ditulis lengkap; pemasangannya keputusan infrastruktur |
| Uji penetrasi (NFR-10) | Perlu dilakukan pihak ketiga sebelum go-live |
| Maker-checker master data (B9) | Izin sudah terpisah sehingga pemisahan tugas mungkin; alur persetujuan dua orang belum dibuat |
| Timestamp tepercaya dan tanda tangan elektronik pada PDF (B10) | Butuh penyedia TSA/sertifikat; hash SHA-256 sudah disimpan sebagai dasar |
| Rate limit terdistribusi saat Redis mati | Saat Redis tidak tersedia, permintaan diteruskan (ketersediaan diutamakan) dan hanya rate limit di nginx yang berlaku. Ini pilihan sadar, bukan kelalaian |
| Enkripsi kolom untuk data pribadi | Belum ada; menunggu hasil review privasi Phase 0 yang menentukan data mana yang tergolong sensitif |

---

## 11. Kerentanan dependensi

`npm audit --omit=dev` pada rilis ini melaporkan 32 temuan di pohon dependensi produksi. Temuan diprioritaskan berdasarkan keterjangkauannya oleh masukan penyerang, bukan berdasarkan angka severity saja, karena sebagian besar paket yang terdaftar tidak pernah menyentuh data yang dikendalikan pihak luar.

Sudah dinaikkan versinya:

| Paket | Dari | Ke | Alasan |
|---|---|---|---|
| `sharp` | 0.33.5 | 0.35.4 | Memroses byte gambar yang diunggah pengguna melalui libvips dan libheif. Ini satu-satunya jalur di sistem ini yang mengantar data penyerang langsung ke dekoder native, jadi diprioritaskan paling tinggi |
| `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express` | 10.4.4 | 10.4.22 | GHSA-cj7v-w2c7-cp7c: eksekusi kode jarak jauh lewat header `Content-Type`. Terjangkau tanpa autentikasi di setiap endpoint |
| `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` | 3.658.1 | 3.1136.0 | Menutup `fast-xml-parser` (severity critical) dan rangkaian `@smithy/*` |
| `cookie-parser` | 1.4.6 | 1.4.7 | GHSA-pxg6-pf52-xh8x pada paket `cookie` |

Semua kenaikan di atas berada pada versi mayor yang sama dan tidak mengubah API yang dipakai kode ini.

Belum ditangani, beserta alasannya:

| Temuan | Status |
|---|---|
| `nodemailer` <= 9.1.0 | Perlu dinaikkan ke 10.x. Beberapa temuannya nyata untuk sistem ini karena alamat email tujuan berasal dari masukan pengguna, terutama GHSA-wmmp-3585-3rmp (pengiriman ke domain yang dikendalikan penyerang lewat IDN/Punycode) dan GHSA-268h-hp4c-crq3 (injeksi header lewat CRLF). Kenaikan ini melintasi batas mayor dan menyentuh definisi tipe, jadi dipisahkan agar dapat diuji tersendiri |
| `multer`, `express`, `body-parser`, `qs`, `path-to-regexp` | Semuanya kelas denial of service dan semuanya dipaku oleh `@nestjs/platform-express` versi 10. Perbaikan resminya menuntut NestJS 12 dan Express 5, yang mengubah routing, middleware, dan tanda tangan interceptor di seluruh berkas. Sampai migrasi itu dijadwalkan, batas ukuran permintaan dan rate limit di reverse proxy yang menahan dampaknya |
| `lodash` <= 4.17.23 | Masuk lewat `@nestjs/config` dan hanya dipakai saat memuat konfigurasi pada waktu boot. Tidak ada masukan penyerang yang sampai ke sana. Perbaikan resminya menuntut `@nestjs/config` 12, yang mensyaratkan NestJS 12 |
| `uuid` < 11.1.1 | Temuannya menyangkut pemeriksaan batas buffer pada v3, v5, dan v6 ketika argumen `buf` diberikan. Kode ini tidak pernah memanggil `uuid` dengan argumen tersebut, dan UUID pada basis data dihasilkan fungsi `uuid_generate_v7()` di PostgreSQL |

Jangan menjalankan `npm audit fix --force` pada proyek ini. Perintah itu akan memasang NestJS 12 dan Express 5 sekaligus, yang membatalkan kompilasi seluruh backend.

Audit ulang dijadwalkan setiap kali `package.json` berubah dan sekurang-kurangnya sekali sebulan. Migrasi ke NestJS 12 sebaiknya dijadwalkan sebagai pekerjaan tersendiri, bukan sebagai tambalan keamanan mendadak.

---

## Melaporkan kerentanan

Temuan keamanan pada sistem ini sebaiknya dilaporkan lewat jalur internal perusahaan, bukan lewat isu publik. Sertakan `requestId` dari respons galat bila ada — nilai itu menghubungkan keluhan dengan baris audit log dan log aplikasi yang bersangkutan.
