/**
 * Seed data — BRD/SRS v1.1.
 *
 * Isinya data master yang membuat sistem dapat dipakai sejak menit pertama:
 * izin, role, jenis tindakan, paket, harga, tarif PPN, platform beserta
 * kebijakannya, dan dasar hukum.
 *
 * Akun demo hanya dibuat di luar production, dengan kata sandi ACAK yang
 * dicetak sekali ke layar. Tidak ada kredensial yang ditulis di dalam kode
 * maupun di dalam dokumen (BRD 4.1 / B6).
 *
 * Seed bersifat idempoten: menjalankannya berulang tidak menggandakan data dan
 * tidak mengganti kata sandi akun yang sudah ada.
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';

const prisma = new PrismaClient();

const PERMISSIONS: Array<[string, string]> = [
  ['report.review', 'Meninjau kelayakan report dan mengambil keputusan review'],
  ['report.fulfill', 'Melaporkan ke platform, mengunggah bukti pengerjaan, menutup report'],
  ['payment.verify', 'Memverifikasi pembayaran manual dan menindaklanjuti rekonsiliasi'],
  ['pricing.manage', 'Mengubah harga satuan dan tarif pajak'],
  ['policy.manage', 'Mengelola master kebijakan platform'],
  ['legal.manage', 'Mengelola master dasar hukum'],
  ['notification.manage', 'Memantau outbox, dead-letter queue, dan mencoba ulang notifikasi'],
  ['audit.read', 'Membaca audit log dan memverifikasi rantai hash'],
  ['user.manage', 'Mengelola akun pengguna dan role'],
];

const ROLES: Array<{ code: string; name: string; isStaff: boolean; permissions: string[] }> = [
  { code: 'user', name: 'Pengguna', isStaff: false, permissions: [] },
  {
    code: 'reviewer',
    name: 'Reviewer',
    isStaff: true,
    permissions: ['report.review'],
  },
  {
    code: 'finance',
    name: 'Finance',
    isStaff: true,
    permissions: ['payment.verify', 'report.review'],
  },
  {
    code: 'admin',
    name: 'Administrator',
    isStaff: true,
    // Pemisahan tugas tetap mungkin: admin tidak otomatis memegang
    // payment.verify supaya maker-checker dapat diterapkan (B9).
    permissions: [
      'report.review',
      'report.fulfill',
      'pricing.manage',
      'policy.manage',
      'legal.manage',
      'notification.manage',
      'audit.read',
      'user.manage',
    ],
  },
];

const PLATFORMS: Array<{
  code: string;
  name: string;
  domains: string[];
  reportUrl: string;
  policies: Array<{ code: string; name: string; category: string; version: string; text: string }>;
}> = [
  {
    code: 'FACEBOOK',
    name: 'Facebook',
    domains: ['facebook.com', 'fb.com', 'fb.watch'],
    reportUrl: 'https://www.facebook.com/help/reportlinks',
    policies: [
      {
        code: 'FB_HATE_SPEECH',
        name: 'Ujaran kebencian',
        category: 'Konten berbahaya',
        version: '2026.1',
        text: 'Konten yang menyerang orang berdasarkan ras, etnis, kebangsaan, agama, orientasi seksual, kasta, jenis kelamin, identitas gender, disabilitas, atau penyakit berat.',
      },
      {
        code: 'FB_HARASSMENT',
        name: 'Pelecehan dan perundungan',
        category: 'Keselamatan',
        version: '2026.1',
        text: 'Konten yang mengintimidasi, mempermalukan, atau menargetkan seseorang secara berulang dengan maksud merendahkan.',
      },
      {
        code: 'FB_IMPERSONATION',
        name: 'Peniruan identitas',
        category: 'Keaslian',
        version: '2026.1',
        text: 'Akun atau halaman yang mengaku sebagai orang, merek, atau organisasi lain tanpa izin.',
      },
      {
        code: 'FB_FRAUD',
        name: 'Penipuan dan kecurangan',
        category: 'Integritas',
        version: '2026.1',
        text: 'Konten yang mengelabui orang agar menyerahkan uang, data pribadi, atau akses akun.',
      },
    ],
  },
  {
    code: 'INSTAGRAM',
    name: 'Instagram',
    domains: ['instagram.com'],
    reportUrl: 'https://help.instagram.com/192435014247952',
    policies: [
      {
        code: 'IG_HARASSMENT',
        name: 'Perundungan dan pelecehan',
        category: 'Keselamatan',
        version: '2026.1',
        text: 'Konten yang secara sengaja mempermalukan, mengancam, atau menargetkan seseorang.',
      },
      {
        code: 'IG_IMPERSONATION',
        name: 'Akun tiruan',
        category: 'Keaslian',
        version: '2026.1',
        text: 'Akun yang meniru orang atau bisnis lain sehingga menyesatkan pengikutnya.',
      },
      {
        code: 'IG_NON_CONSENSUAL',
        name: 'Konten intim tanpa persetujuan',
        category: 'Privasi',
        version: '2026.1',
        text: 'Gambar atau video intim yang dibagikan tanpa persetujuan orang yang ada di dalamnya.',
      },
    ],
  },
  {
    code: 'TIKTOK',
    name: 'TikTok',
    domains: ['tiktok.com', 'vm.tiktok.com'],
    reportUrl: 'https://support.tiktok.com/en/safety-hc/report-a-problem',
    policies: [
      {
        code: 'TT_HARASSMENT',
        name: 'Pelecehan dan perundungan',
        category: 'Keselamatan',
        version: '2026.1',
        text: 'Konten yang merendahkan, mengancam, atau mempermalukan orang lain.',
      },
      {
        code: 'TT_MISINFORMATION',
        name: 'Informasi yang menyesatkan',
        category: 'Integritas',
        version: '2026.1',
        text: 'Konten yang menyebarkan informasi keliru yang dapat menimbulkan bahaya nyata.',
      },
      {
        code: 'TT_SCAM',
        name: 'Penipuan',
        category: 'Integritas',
        version: '2026.1',
        text: 'Skema yang dirancang untuk mengambil uang atau data pengguna dengan menyesatkan.',
      },
    ],
  },
  {
    code: 'X',
    name: 'X',
    domains: ['x.com', 'twitter.com', 't.co'],
    reportUrl: 'https://help.x.com/en/rules-and-policies',
    policies: [
      {
        code: 'X_ABUSE',
        name: 'Perilaku kasar',
        category: 'Keselamatan',
        version: '2026.1',
        text: 'Konten yang melecehkan, mengintimidasi, atau membungkam suara orang lain.',
      },
      {
        code: 'X_PRIVATE_INFO',
        name: 'Penyebaran data pribadi',
        category: 'Privasi',
        version: '2026.1',
        text: 'Menerbitkan informasi pribadi orang lain tanpa izin, termasuk alamat dan nomor identitas.',
      },
      {
        code: 'X_IMPERSONATION',
        name: 'Peniruan identitas',
        category: 'Keaslian',
        version: '2026.1',
        text: 'Akun yang meniru orang atau organisasi lain dengan cara yang menyesatkan.',
      },
    ],
  },
  {
    code: 'YOUTUBE',
    name: 'YouTube',
    domains: ['youtube.com', 'youtu.be'],
    reportUrl: 'https://support.google.com/youtube/answer/2802027',
    policies: [
      {
        code: 'YT_HARASSMENT',
        name: 'Pelecehan dan cyberbullying',
        category: 'Keselamatan',
        version: '2026.1',
        text: 'Konten yang menargetkan seseorang dengan hinaan berkepanjangan atau ancaman.',
      },
      {
        code: 'YT_IMPERSONATION',
        name: 'Peniruan identitas',
        category: 'Keaslian',
        version: '2026.1',
        text: 'Kanal atau konten yang meniru kanal, orang, atau merek lain.',
      },
      {
        code: 'YT_SPAM',
        name: 'Spam dan praktik menyesatkan',
        category: 'Integritas',
        version: '2026.1',
        text: 'Konten yang dibuat untuk menyesatkan penonton demi keuntungan.',
      },
    ],
  },
];

const LAWS: Array<{
  code: string;
  name: string;
  shortName: string;
  version: string;
  articles: Array<{
    number: string;
    title: string;
    paragraphs: Array<{ number: string; text: string; explanation?: string }>;
  }>;
}> = [
  {
    code: 'UU_ITE',
    name: 'Undang-Undang tentang Informasi dan Transaksi Elektronik',
    shortName: 'UU ITE',
    version: 'UU 11/2008 jo. UU 19/2016 jo. UU 1/2024',
    articles: [
      {
        number: '27A',
        title: 'Penyerangan kehormatan atau nama baik',
        paragraphs: [
          {
            number: '(1)',
            text: 'Setiap Orang dengan sengaja menyerang kehormatan atau nama baik orang lain dengan cara menuduhkan suatu hal, dengan maksud supaya hal tersebut diketahui umum dalam bentuk Informasi Elektronik dan/atau Dokumen Elektronik yang dilakukan melalui Sistem Elektronik.',
            explanation:
              'Dipakai untuk konten yang menuduhkan perbuatan tertentu kepada orang yang dapat dikenali.',
          },
        ],
      },
      {
        number: '28',
        title: 'Berita bohong dan kebencian',
        paragraphs: [
          {
            number: '(1)',
            text: 'Setiap Orang dengan sengaja menyebarkan berita bohong yang mengakibatkan kerugian materiel bagi konsumen dalam Transaksi Elektronik.',
          },
          {
            number: '(2)',
            text: 'Setiap Orang dengan sengaja menyebarkan Informasi Elektronik yang ditujukan untuk menimbulkan rasa kebencian atau permusuhan individu dan/atau kelompok masyarakat tertentu berdasarkan suku, agama, ras, dan antargolongan.',
          },
        ],
      },
      {
        number: '29',
        title: 'Ancaman kekerasan',
        paragraphs: [
          {
            number: '(1)',
            text: 'Setiap Orang dengan sengaja mengirimkan Informasi Elektronik yang berisi ancaman kekerasan yang ditujukan secara pribadi.',
          },
        ],
      },
    ],
  },
  {
    code: 'UU_PDP',
    name: 'Undang-Undang tentang Pelindungan Data Pribadi',
    shortName: 'UU PDP',
    version: 'UU 27/2022',
    articles: [
      {
        number: '65',
        title: 'Larangan penggunaan data pribadi',
        paragraphs: [
          {
            number: '(1)',
            text: 'Setiap Orang dilarang secara melawan hukum memperoleh atau mengumpulkan Data Pribadi yang bukan miliknya dengan maksud untuk menguntungkan diri sendiri atau orang lain yang dapat mengakibatkan kerugian Subjek Data Pribadi.',
          },
          {
            number: '(2)',
            text: 'Setiap Orang dilarang secara melawan hukum mengungkapkan Data Pribadi yang bukan miliknya.',
          },
          {
            number: '(3)',
            text: 'Setiap Orang dilarang secara melawan hukum menggunakan Data Pribadi yang bukan miliknya.',
          },
        ],
      },
      {
        number: '66',
        title: 'Larangan pemalsuan data pribadi',
        paragraphs: [
          {
            number: '(1)',
            text: 'Setiap Orang dilarang membuat Data Pribadi palsu atau memalsukan Data Pribadi dengan maksud untuk menguntungkan diri sendiri atau orang lain yang dapat mengakibatkan kerugian bagi orang lain.',
          },
        ],
      },
    ],
  },
  {
    code: 'KUHP_PENGHINAAN',
    name: 'Kitab Undang-Undang Hukum Pidana — ketentuan penghinaan',
    shortName: 'KUHP',
    version: 'UU 1/2023',
    articles: [
      {
        number: '433',
        title: 'Pencemaran',
        paragraphs: [
          {
            number: '(1)',
            text: 'Setiap Orang yang dengan lisan menyerang kehormatan atau nama baik orang lain dengan cara menuduhkan suatu hal supaya diketahui umum.',
          },
        ],
      },
    ],
  },
];

const PAYMENT_METHODS: Array<[string, string, string, number]> = [
  ['VA_MANDIRI', 'Virtual Account Mandiri', 'VIRTUAL_ACCOUNT', 1],
  ['VA_BRI', 'Virtual Account BRI', 'VIRTUAL_ACCOUNT', 2],
  ['VA_BNI', 'Virtual Account BNI', 'VIRTUAL_ACCOUNT', 3],
  ['GOPAY', 'GoPay', 'EWALLET', 4],
  ['DANA', 'DANA', 'EWALLET', 5],
  ['SHOPEEPAY', 'ShopeePay', 'EWALLET', 6],
];

/** Frasa acak yang mudah diketik untuk akun demo. */
function generatePassphrase(): string {
  const words = [
    'hujan', 'senja', 'kopi', 'jembatan', 'pelabuhan', 'cemara', 'mercusuar',
    'kabut', 'gerimis', 'pasir', 'bambu', 'anggrek', 'rusa', 'elang', 'nakhoda',
  ];
  const pick = (): string => words[randomBytes(1)[0] % words.length];
  const digits = (randomBytes(2).readUInt16BE(0) % 9000) + 1000;
  return `${pick()}-${pick()}-${pick()}-${digits}`;
}

async function seedPermissionsAndRoles(): Promise<void> {
  for (const [code, description] of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code },
      update: { description },
      create: { code, description },
    });
  }

  for (const role of ROLES) {
    const saved = await prisma.role.upsert({
      where: { code: role.code },
      update: { name: role.name, isStaff: role.isStaff },
      create: { code: role.code, name: role.name, isStaff: role.isStaff },
    });

    await prisma.rolePermission.deleteMany({ where: { roleId: saved.id } });

    for (const permissionCode of role.permissions) {
      const permission = await prisma.permission.findUniqueOrThrow({
        where: { code: permissionCode },
      });
      await prisma.rolePermission.create({
        data: { roleId: saved.id, permissionId: permission.id },
      });
    }
  }

  console.log(`  role dan izin siap (${ROLES.length} role, ${PERMISSIONS.length} izin)`);
}

async function seedCatalogue(): Promise<void> {
  const actionTypes: Array<[string, string]> = [
    ['REPORT_POST', 'Laporkan postingan'],
    ['REPORT_ACCOUNT', 'Laporkan akun'],
  ];
  for (const [code, name] of actionTypes) {
    await prisma.actionType.upsert({ where: { code }, update: { name }, create: { code, name } });
  }

  for (const quantity of [300, 500, 1000, 1500]) {
    const code = `PKG_${quantity}`;
    await prisma.package.upsert({
      where: { code },
      update: { quantity, active: true },
      create: { code, quantity },
    });
  }

  for (const [code, name, group, sortOrder] of PAYMENT_METHODS) {
    await prisma.paymentMethod.upsert({
      where: { code },
      update: { name, group, sortOrder },
      create: { code, name, group, sortOrder },
    });
  }

  // Harga baseline Rp1.000 per unit dan PPN 11% (BRD 1 dan 6).
  const effectiveFrom = new Date('2025-01-01T00:00:00Z');

  if ((await prisma.pricingConfig.count()) === 0) {
    await prisma.pricingConfig.create({ data: { unitPrice: 1000n, effectiveFrom } });
  }
  if ((await prisma.taxConfig.count()) === 0) {
    await prisma.taxConfig.create({ data: { taxName: 'PPN', rateBp: 1100, effectiveFrom } });
  }

  console.log('  paket, metode pembayaran, harga, dan tarif PPN siap');
}

async function seedPlatformsAndPolicies(): Promise<void> {
  const effectiveFrom = new Date('2025-01-01T00:00:00Z');

  for (const platform of PLATFORMS) {
    const saved = await prisma.socialPlatform.upsert({
      where: { code: platform.code },
      update: { name: platform.name, domains: platform.domains, reportUrl: platform.reportUrl },
      create: {
        code: platform.code,
        name: platform.name,
        domains: platform.domains,
        reportUrl: platform.reportUrl,
      },
    });

    for (const policy of platform.policies) {
      const savedPolicy = await prisma.platformPolicy.upsert({
        where: { platformId_code: { platformId: saved.id, code: policy.code } },
        update: { name: policy.name, category: policy.category },
        create: {
          platformId: saved.id,
          code: policy.code,
          name: policy.name,
          category: policy.category,
        },
      });

      await prisma.platformPolicyVersion.upsert({
        where: {
          policyId_version: { policyId: savedPolicy.id, version: policy.version },
        },
        update: { text: policy.text },
        create: {
          policyId: savedPolicy.id,
          version: policy.version,
          text: policy.text,
          effectiveFrom,
        },
      });
    }
  }

  const policyCount = await prisma.platformPolicy.count();
  console.log(`  ${PLATFORMS.length} platform dengan ${policyCount} kebijakan siap`);
}

async function seedLaws(): Promise<void> {
  const effectiveFrom = new Date('2024-01-01T00:00:00Z');

  for (const law of LAWS) {
    const savedLaw = await prisma.law.upsert({
      where: { code: law.code },
      update: { name: law.name, shortName: law.shortName },
      create: { code: law.code, name: law.name, shortName: law.shortName },
    });

    const savedVersion = await prisma.legalVersion.upsert({
      where: { lawId_version: { lawId: savedLaw.id, version: law.version } },
      update: {},
      create: { lawId: savedLaw.id, version: law.version, effectiveFrom },
    });

    for (const article of law.articles) {
      const savedArticle = await prisma.legalArticle.upsert({
        where: {
          legalVersionId_number: { legalVersionId: savedVersion.id, number: article.number },
        },
        update: { title: article.title },
        create: {
          legalVersionId: savedVersion.id,
          number: article.number,
          title: article.title,
        },
      });

      for (const paragraph of article.paragraphs) {
        await prisma.legalParagraph.upsert({
          where: {
            articleId_number: { articleId: savedArticle.id, number: paragraph.number },
          },
          update: { text: paragraph.text, explanation: paragraph.explanation },
          create: {
            articleId: savedArticle.id,
            number: paragraph.number,
            text: paragraph.text,
            explanation: paragraph.explanation,
          },
        });
      }
    }
  }

  const paragraphCount = await prisma.legalParagraph.count();
  console.log(`  ${LAWS.length} dasar hukum dengan ${paragraphCount} ayat siap`);
}

async function seedDemoAccounts(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    console.log('  akun demo dilewati (NODE_ENV=production)');
    return;
  }

  const accounts: Array<{ email: string; fullName: string; roleCode: string }> = [
    { email: 'pengguna@contoh.test', fullName: 'Pengguna Demo', roleCode: 'user' },
    { email: 'admin@contoh.test', fullName: 'Admin Operasional', roleCode: 'admin' },
    { email: 'reviewer@contoh.test', fullName: 'Reviewer Konten', roleCode: 'reviewer' },
    { email: 'finance@contoh.test', fullName: 'Petugas Finance', roleCode: 'finance' },
  ];

  const created: Array<[string, string, string]> = [];

  for (const account of accounts) {
    const existing = await prisma.user.findUnique({ where: { email: account.email } });
    if (existing) continue;

    const role = await prisma.role.findUniqueOrThrow({ where: { code: account.roleCode } });
    const password = generatePassphrase();

    await prisma.user.create({
      data: {
        email: account.email,
        fullName: account.fullName,
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        roleId: role.id,
        status: 'ACTIVE',
        // Email dianggap terverifikasi agar akun demo langsung dapat dipakai.
        emailVerifiedAt: new Date(),
        mfaEnabled: role.isStaff,
      },
    });

    created.push([account.email, account.roleCode, password]);
  }

  if (created.length === 0) {
    console.log('  akun demo sudah ada; kata sandi tidak diubah');
    return;
  }

  console.log('\n  ┌─────────────────────────────────────────────────────────────────────┐');
  console.log('  │ AKUN DEMO — kata sandi ini hanya ditampilkan SEKALI                 │');
  console.log('  │ Akun internal (admin/reviewer/finance) wajib memasukkan kode OTP     │');
  console.log('  │ yang dapat dibaca di halaman /dev/mailbox.                           │');
  console.log('  └─────────────────────────────────────────────────────────────────────┘');
  for (const [email, role, password] of created) {
    console.log(`   ${role.padEnd(9)} ${email.padEnd(26)} ${password}`);
  }
  console.log('');
}

async function main(): Promise<void> {
  console.log('Menyiapkan data awal...');
  await seedPermissionsAndRoles();
  await seedCatalogue();
  await seedPlatformsAndPolicies();
  await seedLaws();
  await seedDemoAccounts();
  console.log('Selesai.');
}

main()
  .catch((error) => {
    console.error('Seed gagal:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
