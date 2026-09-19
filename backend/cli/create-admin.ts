/**
 * Pembuatan akun admin pertama — BRD/SRS v1.1 §4.1 (B6).
 *
 *   node dist/cli/create-admin.js [email]
 *
 * Aturannya:
 *   - kata sandi DIBUAT ACAK di sini dan dicetak sekali ke layar;
 *   - akun ditandai wajib mengganti kata sandi pada login pertama;
 *   - MFA langsung aktif karena akun internal mewajibkannya;
 *   - tidak ada kredensial yang ditulis di kode, dokumen, atau berkas env.
 *
 * Jalankan sekali saat pemasangan, lalu simpan kata sandinya di pengelola
 * kata sandi dan tutup terminal.
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';

const prisma = new PrismaClient();

function generatePassword(): string {
  // 24 byte acak -> 32 karakter base64url. Jauh di atas batas 12 karakter
  // untuk akun internal, dan tidak mungkin ada pada daftar kata sandi bocor.
  return randomBytes(24).toString('base64url');
}

async function main(): Promise<void> {
  const email = (process.argv[2] ?? process.env.BOOTSTRAP_ADMIN_EMAIL ?? '').trim().toLowerCase();

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error(
      'Alamat email wajib diisi.\n' +
        '  Pemakaian: node dist/cli/create-admin.js admin@perusahaan.example',
    );
    process.exit(1);
  }

  const role = await prisma.role.findUnique({ where: { code: 'admin' } });
  if (!role) {
    console.error('Role "admin" belum ada. Jalankan migrasi dan seed terlebih dahulu.');
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.error(`Akun ${email} sudah ada. CLI ini hanya untuk akun pertama.`);
    process.exit(1);
  }

  const password = generatePassword();

  const user = await prisma.user.create({
    data: {
      email,
      fullName: 'Administrator',
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      roleId: role.id,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      mfaEnabled: true,
      mustChangePassword: true,
    },
  });

  console.log('');
  console.log('  Akun administrator dibuat.');
  console.log('  ────────────────────────────────────────────────────────────');
  console.log(`  Email        : ${user.email}`);
  console.log(`  Kata sandi   : ${password}`);
  console.log('  ────────────────────────────────────────────────────────────');
  console.log('  Kata sandi ini TIDAK akan ditampilkan lagi.');
  console.log('  Wajib diganti pada login pertama, dan login akan meminta kode OTP');
  console.log('  yang dikirim ke alamat email di atas.');
  console.log('');
}

main()
  .catch((error) => {
    console.error('Gagal membuat akun:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
