/**
 * Mengisi katalog hukum dengan pasal UU ITE yang relevan untuk pelaporan
 * konten.
 *
 *   node dist/cli/seed-uu-ite.js
 *
 * Aman dijalankan berkali-kali. Undang-undang, versi, pasal, dan ayat yang
 * sudah ada dilewati, bukan ditimpa — sehingga penyuntingan teks yang pernah
 * dilakukan admin lewat panel tidak hilang karena skrip ini dijalankan ulang.
 *
 * ---------------------------------------------------------------------------
 * SUMBER DAN TANGGUNG JAWAB
 *
 * Teks di bawah disalin dari naskah UU Nomor 1 Tahun 2024 tentang Perubahan
 * Kedua atas UU Nomor 11 Tahun 2008 tentang Informasi dan Transaksi
 * Elektronik, sebagaimana dipublikasikan JDIH Kementerian Komunikasi dan
 * Digital.
 *
 * Teks ini dipakai untuk menyusun surat aduan resmi. Karena itu, sebelum
 * `KOMDIGI_ENABLED` dinyalakan, cocokkan sekali lagi setiap ayat di bawah
 * dengan naskah resmi di jdih.komdigi.go.id atau peraturan.bpk.go.id. Satu
 * kata yang meleset pada kutipan pasal membuat surat kehilangan kredibilitas
 * di mata instansi yang membacanya.
 *
 * Skrip ini sengaja TIDAK memuat penafsiran "pasal ini untuk kasus itu".
 * Menentukan pasal yang berlaku atas suatu perbuatan adalah kewenangan
 * penegak hukum, bukan sistem ini.
 * ---------------------------------------------------------------------------
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const KODE_HUKUM = 'UU_ITE';
const NAMA_HUKUM =
  'Undang-Undang Nomor 11 Tahun 2008 tentang Informasi dan Transaksi Elektronik ' +
  'sebagaimana telah diubah terakhir dengan Undang-Undang Nomor 1 Tahun 2024';
const NAMA_PENDEK = 'UU ITE';
const VERSI = 'UU 1/2024';

/** Tanggal pengundangan UU Nomor 1 Tahun 2024. */
const BERLAKU_SEJAK = new Date('2024-01-02T00:00:00+07:00');

interface Ayat {
  number: string;
  text: string;
}

interface Pasal {
  number: string;
  title: string;
  paragraphs: Ayat[];
}

/**
 * Pasal yang membuka jalan penghapusan konten, sesuai daftar pada gerbang
 * kelayakan Komdigi (`TAKEDOWN_ELIGIBLE_ARTICLES`).
 *
 * Pasal 40 tidak dimuat di sini dengan sengaja: pasal itu mengatur kewenangan
 * pemerintah memutus akses, bukan perbuatan yang dilanggar seseorang. Ia bukan
 * dasar hukum yang dapat dipilih pelapor.
 */
const PASAL: Pasal[] = [
  {
    number: '27',
    title: 'Kesusilaan dan perjudian',
    paragraphs: [
      {
        number: '1',
        text:
          'Setiap Orang dengan sengaja dan tanpa hak menyiarkan, mempertunjukkan, ' +
          'mendistribusikan, mentransmisikan, dan/atau membuat dapat diaksesnya ' +
          'Informasi Elektronik dan/atau Dokumen Elektronik yang memiliki muatan yang ' +
          'melanggar kesusilaan untuk diketahui umum.',
      },
      {
        number: '2',
        text:
          'Setiap Orang dengan sengaja dan tanpa hak mendistribusikan, mentransmisikan, ' +
          'dan/atau membuat dapat diaksesnya Informasi Elektronik dan/atau Dokumen ' +
          'Elektronik yang memiliki muatan perjudian.',
      },
    ],
  },
  {
    number: '27A',
    title: 'Penyerangan kehormatan atau nama baik',
    paragraphs: [
      {
        number: '1',
        text:
          'Setiap Orang dengan sengaja menyerang kehormatan atau nama baik orang lain ' +
          'dengan cara menuduhkan suatu hal, dengan maksud supaya hal tersebut diketahui ' +
          'umum dalam bentuk Informasi Elektronik dan/atau Dokumen Elektronik yang ' +
          'dilakukan melalui Sistem Elektronik.',
      },
    ],
  },
  {
    number: '27B',
    title: 'Pemerasan dengan ancaman kekerasan atau ancaman pencemaran',
    paragraphs: [
      {
        number: '1',
        text:
          'Setiap Orang dengan sengaja dan tanpa hak mendistribusikan dan/atau ' +
          'mentransmisikan Informasi Elektronik dan/atau Dokumen Elektronik, dengan ' +
          'maksud untuk menguntungkan diri sendiri atau orang lain secara melawan hukum, ' +
          'memaksa orang dengan ancaman kekerasan untuk: a. memberikan suatu barang, yang ' +
          'sebagian atau seluruhnya milik orang tersebut atau milik orang lain; atau ' +
          'b. memberi utang, membuat pengakuan utang, atau menghapuskan piutang.',
      },
      {
        number: '2',
        text:
          'Setiap Orang dengan sengaja dan tanpa hak mendistribusikan dan/atau ' +
          'mentransmisikan Informasi Elektronik dan/atau Dokumen Elektronik, dengan ' +
          'maksud untuk menguntungkan diri sendiri atau orang lain secara melawan hukum, ' +
          'dengan ancaman pencemaran atau dengan ancaman akan membuka rahasia, memaksa ' +
          'orang supaya: a. memberikan suatu barang yang sebagian atau seluruhnya milik ' +
          'orang tersebut atau milik orang lain; atau b. memberi utang, membuat pengakuan ' +
          'utang, atau menghapuskan piutang.',
      },
    ],
  },
  {
    number: '28',
    title: 'Berita bohong, ujaran kebencian, dan kerusuhan',
    paragraphs: [
      {
        number: '1',
        text:
          'Setiap Orang dengan sengaja mendistribusikan dan/atau mentransmisikan ' +
          'Informasi Elektronik dan/atau Dokumen Elektronik yang berisi pemberitahuan ' +
          'bohong atau informasi menyesatkan yang mengakibatkan kerugian materiel bagi ' +
          'konsumen dalam Transaksi Elektronik.',
      },
      {
        number: '2',
        text:
          'Setiap Orang dengan sengaja dan tanpa hak mendistribusikan dan/atau ' +
          'mentransmisikan Informasi Elektronik dan/atau Dokumen Elektronik yang sifatnya ' +
          'menghasut, mengajak, atau memengaruhi orang lain sehingga menimbulkan rasa ' +
          'kebencian atau permusuhan terhadap individu dan/atau kelompok masyarakat ' +
          'tertentu berdasarkan ras, kebangsaan, etnis, warna kulit, agama, kepercayaan, ' +
          'jenis kelamin, disabilitas mental, atau disabilitas fisik.',
      },
      {
        number: '3',
        text:
          'Setiap Orang dengan sengaja menyebarkan Informasi Elektronik dan/atau Dokumen ' +
          'Elektronik yang diketahuinya memuat pemberitahuan bohong yang menimbulkan ' +
          'kerusuhan di masyarakat.',
      },
    ],
  },
  {
    number: '29',
    title: 'Ancaman kekerasan atau menakut-nakuti yang ditujukan pribadi',
    paragraphs: [
      {
        number: '1',
        text:
          'Setiap Orang dengan sengaja dan tanpa hak mengirimkan Informasi Elektronik ' +
          'dan/atau Dokumen Elektronik secara langsung kepada korban yang berisi ancaman ' +
          'kekerasan dan/atau menakut-nakuti.',
      },
    ],
  },
];

async function main(): Promise<void> {
  const law = await prisma.law.upsert({
    where: { code: KODE_HUKUM },
    update: {},
    create: { code: KODE_HUKUM, name: NAMA_HUKUM, shortName: NAMA_PENDEK },
    select: { id: true, name: true },
  });

  const version = await prisma.legalVersion.upsert({
    where: { lawId_version: { lawId: law.id, version: VERSI } },
    update: {},
    create: { lawId: law.id, version: VERSI, effectiveFrom: BERLAKU_SEJAK },
    select: { id: true },
  });

  let pasalBaru = 0;
  let ayatBaru = 0;

  for (const pasal of PASAL) {
    const article = await prisma.legalArticle.upsert({
      where: {
        legalVersionId_number: { legalVersionId: version.id, number: pasal.number },
      },
      update: {},
      create: {
        legalVersionId: version.id,
        number: pasal.number,
        title: pasal.title,
      },
      select: { id: true, createdAt: true },
    });

    // `upsert` tidak memberi tahu apakah baris dibuat atau ditemukan, jadi
    // selisih waktu dipakai sebagai penanda. Cukup untuk laporan di layar.
    if (Date.now() - article.createdAt.getTime() < 5000) pasalBaru += 1;

    for (const ayat of pasal.paragraphs) {
      const sudahAda = await prisma.legalParagraph.findUnique({
        where: { articleId_number: { articleId: article.id, number: ayat.number } },
        select: { id: true },
      });

      if (sudahAda) continue;

      await prisma.legalParagraph.create({
        data: { articleId: article.id, number: ayat.number, text: ayat.text },
      });
      ayatBaru += 1;
    }
  }

  const totalAyat = await prisma.legalParagraph.count({
    where: { article: { legalVersionId: version.id } },
  });

  console.log('');
  console.log('  Katalog UU ITE diperbarui.');
  console.log('  ────────────────────────────────────────────────────────────');
  console.log(`  Undang-undang : ${law.name}`);
  console.log(`  Versi         : ${VERSI}`);
  console.log(`  Pasal baru    : ${pasalBaru}`);
  console.log(`  Ayat baru     : ${ayatBaru}`);
  console.log(`  Total ayat    : ${totalAyat}`);
  console.log('  ────────────────────────────────────────────────────────────');
  console.log('  Cocokkan teks pasal dengan naskah resmi sebelum menyalakan');
  console.log('  penerusan aduan ke Komdigi.');
  console.log('');
}

main()
  .catch((error) => {
    console.error('Gagal mengisi katalog:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
