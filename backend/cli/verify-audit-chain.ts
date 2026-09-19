/**
 * Verifikasi rantai hash audit log — BRD/SRS v1.1 §4.5, AC-33.
 *
 *   node dist/cli/verify-audit-chain.js [seq_awal]
 *
 * Keluar dengan kode 0 bila rantai utuh, 1 bila ada baris yang tidak cocok.
 * Cocok dipakai sebagai pemeriksaan berkala di luar aplikasi, sehingga
 * verifikasi tidak bergantung pada proses yang menulis audit itu sendiri.
 */
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const fromSeq = BigInt(process.argv[2] ?? '0');

  const problems = await prisma.$queryRaw<
    Array<{ bad_seq: bigint; bad_audit_id: string; reason: string }>
  >(Prisma.sql`SELECT * FROM audit_verify_chain(${fromSeq}::bigint)`);

  const total = await prisma.auditLog.count();
  const latest = await prisma.auditLog.findFirst({
    orderBy: { seq: 'desc' },
    select: { seq: true, entryHash: true, occurredAt: true },
  });

  console.log('');
  console.log('  Verifikasi rantai hash audit log');
  console.log('  ────────────────────────────────────────────────────────────');
  console.log(`  Jumlah entri     : ${total}`);
  if (latest) {
    console.log(`  Entri terakhir   : seq ${latest.seq} (${latest.occurredAt.toISOString()})`);
    console.log(`  Hash terakhir    : ${latest.entryHash}`);
  }

  if (problems.length === 0) {
    console.log('  Hasil            : UTUH — seluruh entri konsisten');
    console.log('');
    return;
  }

  console.log(`  Hasil            : RUSAK — ${problems.length} temuan`);
  for (const problem of problems) {
    console.log(`   - seq ${problem.bad_seq} (${problem.bad_audit_id}): ${problem.reason}`);
  }
  console.log('');
  process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error('Verifikasi gagal dijalankan:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
