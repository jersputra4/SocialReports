import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { getRequestContext } from '../context/request-context';
import { AuditActionValue } from './audit-actions';

export interface AuditEntry {
  action: AuditActionValue;
  entityType?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  /** Menimpa aktor dari konteks permintaan — dipakai job worker. */
  actorId?: string | null;
  actorRole?: string | null;
}

/**
 * Kunci yang nilainya tidak pernah ditulis ke audit log (BRD 4.5:
 * "Nilai sensitif di kolom before/after di-redact").
 */
const REDACTED_KEYS = [
  'password', 'passwordhash', 'password_hash', 'newpassword', 'currentpassword',
  'token', 'tokenhash', 'token_hash', 'otp', 'otphash', 'otp_hash', 'secret',
  'csrftoken', 'csrf_token', 'signature', 'authorization', 'cookie',
  'accesskey', 'secretkey', 'rawpayload',
];

const REDACTED = '[redacted]';

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || value === undefined) return value ?? null;

  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = REDACTED_KEYS.includes(key.toLowerCase()) ? REDACTED : redact(val, depth + 1);
    }
    return out;
  }

  return value;
}

/**
 * Penulis audit log.
 *
 * prev_hash dan entry_hash sengaja dikirim kosong: nilainya dihitung trigger
 * database (migrasi 0002) dalam transaksi yang sama. Dengan begitu rantai hash
 * tetap benar walaupun ada beberapa instance API yang menulis bersamaan, dan
 * tidak bergantung pada kebenaran kode aplikasi.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Mencatat satu entri. Bila `tx` diberikan, entri ditulis dalam transaksi
   * yang sama dengan perubahan datanya — inilah yang membuat audit tidak
   * pernah menyimpang dari data.
   */
  async record(entry: AuditEntry, tx?: Prisma.TransactionClient): Promise<void> {
    const context = getRequestContext();
    const client = tx ?? this.prisma;

    const data: Prisma.AuditLogUncheckedCreateInput = {
      action: entry.action,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      actorId: entry.actorId !== undefined ? entry.actorId : (context?.actorId ?? null),
      actorRole: entry.actorRole !== undefined ? entry.actorRole : (context?.actorRole ?? null),
      ipAddress: context?.ipAddress ?? null,
      userAgent: context?.userAgent?.slice(0, 512) ?? null,
      requestId: context?.requestId ?? null,
      beforeJson: entry.before === undefined ? Prisma.DbNull : (redact(entry.before) as Prisma.InputJsonValue),
      afterJson: entry.after === undefined ? Prisma.DbNull : (redact(entry.after) as Prisma.InputJsonValue),
      // Diisi trigger audit_logs_chain.
      prevHash: '',
      entryHash: '',
    };

    try {
      await client.auditLog.create({ data });
    } catch (error) {
      // Audit tidak boleh menjatuhkan permintaan di luar transaksi bisnis;
      // di dalam transaksi, kegagalan memang harus membatalkan perubahan.
      if (tx) throw error;
      this.logger.error(`Gagal menulis audit ${entry.action}: ${(error as Error).message}`);
    }
  }

  /** Verifikasi rantai hash (AC-33). Mengembalikan daftar baris yang rusak. */
  async verifyChain(fromSeq = 0n): Promise<Array<{ badSeq: bigint; badAuditId: string; reason: string }>> {
    const rows = await this.prisma.$queryRaw<
      Array<{ bad_seq: bigint; bad_audit_id: string; reason: string }>
    >(Prisma.sql`SELECT * FROM audit_verify_chain(${fromSeq}::bigint)`);

    return rows.map((row) => ({
      badSeq: row.bad_seq,
      badAuditId: row.bad_audit_id,
      reason: row.reason,
    }));
  }

  /** Hash dan nomor urut terakhir — dipakai checkpoint harian ke object storage. */
  async latestCheckpoint(): Promise<{ seq: bigint; hash: string } | null> {
    const row = await this.prisma.auditLog.findFirst({
      orderBy: { seq: 'desc' },
      select: { seq: true, entryHash: true },
    });
    return row ? { seq: row.seq, hash: row.entryHash } : null;
  }
}
