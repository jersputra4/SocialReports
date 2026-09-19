# SOP Operasional

Panduan kerja untuk Reviewer, Admin operasional, dan Finance.

---

## Reviewer — memutuskan kelayakan report

**Kapan:** report berstatus `WAITING_REVIEW`. Target KPI-01: keputusan dalam p90 ≤ 2 hari kerja sejak `PAID`.

**Langkah**

1. Buka **Admin → Dasbor** lalu pilih report dari antrean (tertua di atas).
2. Periksa empat hal:
   * **Target** — tautan mengarah ke platform yang didukung dan masih dapat dikenali.
   * **Kebijakan** — pelanggaran yang dipilih benar-benar cocok dengan isi konten.
   * **Dasar hukum** — pasal yang dipilih relevan. Ini dokumentasi argumen pelapor, bukan putusan hukum.
   * **Evidence** — tangkapan layar menunjukkan konten yang dimaksud, bukan hal lain.
3. Tekan **Putuskan review** lalu pilih salah satu:

| Keputusan | Dipakai ketika | Akibat |
|---|---|---|
| **Setujui** | Semua cocok dan bukti memadai | Masuk antrean pelaporan admin |
| **Minta perbaikan** | Ada yang kurang tetapi dapat diperbaiki pelapor | Pelapor memperbaiki **tanpa pembayaran baru** |
| **Tolak** | Tidak memenuhi kriteria dan tidak dapat diperbaiki | Final, tanpa pengembalian dana |

**Menulis alasan.** Minimal 10 karakter, tetapi yang penting bukan panjangnya. Pelapor membaca alasan pada keputusan "minta perbaikan", jadi sebutkan hal yang konkret: *"Tangkapan layar hanya memuat komentar, belum memuat postingan utamanya. Mohon tambahkan tangkapan layar postingan lengkap beserta nama akunnya."* — bukan *"bukti kurang"*.

**Jangan** menolak report hanya karena metadata target gagal diambil. Konten dapat sudah dihapus atau platform menolak permintaan; evidence dari pelapor tetap menjadi dasar penilaian.

---

## Admin operasional — melaporkan dan membuktikan

**Kapan:** report berstatus `APPROVED`. Target KPI-02: dilaporkan dalam p90 ≤ 1 hari kerja.

### Melaporkan ke platform

1. Laporkan lewat **jalur resmi platform**. Sistem ini tidak melapor otomatis dan tidak pernah memakai kredensial media sosial siapa pun.
2. Kembali ke sistem, tekan **Catat pelaporan ke platform**, lalu isi:
   * kanal yang dipakai,
   * nomor acuan dari platform bila diberikan,
   * catatan internal bila ada hal yang perlu diingat.
3. Report berpindah ke `SUBMITTED`. Tanpa pencatatan ini, status tidak dapat berpindah — itu disengaja, supaya klaim "sudah dilaporkan" selalu punya jejak.

### Mengunggah bukti pengerjaan

Target KPI-03: bukti pertama dalam p90 ≤ 1 hari kerja sejak `SUBMITTED`.

1. Tekan **Unggah bukti pengerjaan**.
2. **Sebelum mengunggah, potong atau samarkan data pribadi pihak lain** pada tangkapan layar: nama dan foto orang yang tidak berkaitan, nomor telepon, alamat, dan isi percakapan yang tidak relevan. Data lokasi pada foto dibuang otomatis oleh sistem, tetapi apa yang terlihat di gambar adalah tanggung jawab Anda.
3. Isi:
   * **Jenis bukti** — postingan atau akun yang dilaporkan.
   * **Waktu pelaporan dilakukan** — waktu Anda benar-benar melapor, bukan waktu mengunggah. Tidak boleh di masa depan dan tidak boleh mendahului saat report disetujui.
   * **Jumlah unit tercakup** — isi bila satu bukti mencakup sebagian unit saja. Kolom inilah yang menggerakkan status `PARTIALLY_COMPLETED` dan batang progres yang dilihat pelapor.
   * **Tampilkan ke pelapor** — biarkan aktif kecuali ada alasan kuat. Bukti yang disembunyikan tidak dapat dipakai untuk menandai report selesai.

### Menutup report

* **Selesai sebagian** — ada bukti aktif tetapi jumlah unit belum terpenuhi.
* **Selesai** — unit terpenuhi (atau kolom unit memang tidak dipakai) dan ada minimal satu bukti aktif yang terlihat pelapor. Sistem menolak bila syarat itu belum terpenuhi.
* **Gagal** — pelaporan tidak dapat dilakukan. Alasan wajib. Report dapat dicoba ulang nanti; penghitung percobaan bertambah.

### Membatalkan bukti (void)

Bukti **tidak pernah dihapus**. Bila ada bukti yang salah unggah atau memuat data yang seharusnya disamarkan:

1. Tekan **Void** pada bukti tersebut.
2. Tulis alasan minimal 10 karakter.
3. Sistem meminta **kode OTP baru** ke email Anda — ini disengaja, karena void mengubah apa yang dilihat pelapor.
4. Bukti hilang dari tampilan pelapor, tetap terlihat admin beserta alasannya, dan tercatat permanen di audit log.

Bila report sudah berstatus selesai, bukti terakhir tidak dapat di-void. Unggah bukti pengganti terlebih dahulu.

---

## Finance — pembayaran tertahan

**Kapan:** ada pembayaran berstatus `MANUAL_REVIEW`, biasanya karena kurang bayar.

1. Buka **Admin → Pembayaran**.
2. Periksa selisihnya. Pelapor mungkin sudah menambah pembayaran; bila totalnya sudah mencukupi, sistem menandainya lunas sendiri tanpa tindakan Anda.
3. Bila perlu diputuskan:
   * **Terima** — report dilanjutkan ke antrean review. Dipakai ketika selisihnya berasal dari biaya transfer atau pembulatan yang wajar.
   * **Tolak** — pelapor dapat membuat tagihan baru dengan harga yang berlaku saat itu.
4. Alasan wajib minimal 10 karakter dan tercatat di audit log.

**Tidak ada alur pengembalian dana.** Kelebihan bayar dicatat pada `overpaid_amount` dan tidak dikembalikan. Sampaikan hal ini apa adanya bila pelapor bertanya.

### Rekonsiliasi

Job harian membandingkan laporan settlement gateway dengan tabel pembayaran. Selisih yang muncul di daftar rekonsiliasi **harus ditindaklanjuti dalam 1 hari kerja**. Setelah diselesaikan di sisi gateway atau pembukuan, tandai selesai agar tidak terhitung dua kali.

---

## Semua peran — ketika notifikasi tertahan

Bila dasbor menampilkan peringatan notifikasi:

1. Buka **Admin → Notifikasi**.
2. **Backlog tertua > 5 menit** biasanya berarti layanan automation sedang mati. Event tidak hilang — ia menunggu di tabel outbox dan terkirim sendiri setelah layanan pulih.
3. **Dead-letter queue > 0** berarti event sudah gagal 8 kali dalam 24 jam. Perbaiki penyebabnya lebih dulu (lihat pesan galat pada event), baru tekan **Coba ulang**.
4. Setiap percobaan ulang manual tercatat di audit log beserta siapa yang melakukannya.

---

## Hal yang tidak boleh dilakukan

* Jangan menjanjikan konten akan diturunkan. Sistem ini membuat laporan; keputusan penurunan ada pada platform.
* Jangan memakai akun media sosial pribadi atau perusahaan yang kredensialnya disimpan di sistem — sistem ini memang tidak menyimpannya, dan tidak boleh mulai menyimpannya.
* Jangan mengunggah tangkapan layar yang memuat data pribadi pihak ketiga yang tidak berkaitan dengan laporan.
* Jangan menutup report sebagai selesai tanpa bukti yang benar-benar menunjukkan pelaporan sudah dilakukan.
