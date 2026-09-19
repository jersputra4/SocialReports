import { Controller, Get, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../common/audit/audit.service';
import { AuditAction } from '../common/audit/audit-actions';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthenticatedUser } from '../common/security/auth.types';
import { CurrentUser, RequirePermissions } from '../common/security/decorators';

/**
 * Pembacaan audit log (BRD 4.5).
 *
 * Dibatasi izin `audit.read`, dan setiap pembacaan itu sendiri dicatat sebagai
 * AUDIT_LOG_VIEW — sehingga siapa yang melihat apa juga ikut terekam.
 */
@Controller('admin/audit')
export class AuditController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('logs')
  @RequirePermissions('audit.read')
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('action') action?: string,
    @Query('entityId') entityId?: string,
    @Query('actorId') actorId?: string,
    @Query('limit') limit?: string,
  ) {
    const take = Math.min(200, Math.max(1, Number.parseInt(limit ?? '50', 10) || 50));

    const where: Prisma.AuditLogWhereInput = {};
    if (action) where.action = action;
    if (entityId) where.entityId = entityId;
    if (actorId) where.actorId = actorId;

    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: { seq: 'desc' },
      take,
    });

    await this.audit.record({
      action: AuditAction.AUDIT_LOG_VIEW,
      entityType: 'audit_log',
      entityId: entityId ?? action ?? 'all',
      actorId: user.id,
      actorRole: user.roleCode,
      after: { filters: { action, entityId, actorId }, count: rows.length },
    });

    return rows.map((row) => ({
      seq: row.seq.toString(),
      occurredAt: row.occurredAt,
      actorId: row.actorId,
      actorRole: row.actorRole,
      ipAddress: row.ipAddress,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      before: row.beforeJson,
      after: row.afterJson,
      requestId: row.requestId,
      prevHash: row.prevHash,
      entryHash: row.entryHash,
    }));
  }

  /** Verifikasi rantai hash sesuai permintaan (AC-33). */
  @Get('verify-chain')
  @RequirePermissions('audit.read')
  async verify(@CurrentUser() user: AuthenticatedUser) {
    const problems = await this.audit.verifyChain();
    const checkpoint = await this.audit.latestCheckpoint();

    await this.audit.record({
      action: AuditAction.AUDIT_LOG_VIEW,
      entityType: 'audit_chain',
      entityId: 'verify',
      actorId: user.id,
      actorRole: user.roleCode,
      after: { problems: problems.length },
    });

    return {
      valid: problems.length === 0,
      problems: problems.map((problem) => ({
        seq: problem.badSeq.toString(),
        auditId: problem.badAuditId,
        reason: problem.reason,
      })),
      latest: checkpoint
        ? { seq: checkpoint.seq.toString(), hash: checkpoint.hash }
        : null,
    };
  }

  @Get('checkpoints')
  @RequirePermissions('audit.read')
  async checkpoints() {
    const rows = await this.prisma.auditCheckpoint.findMany({
      orderBy: { forDate: 'desc' },
      take: 60,
    });
    return rows.map((row) => ({
      forDate: row.forDate,
      lastSeq: row.lastSeq.toString(),
      lastHash: row.lastHash,
      verified: row.verified,
      storagePath: row.storagePath,
      createdAt: row.createdAt,
    }));
  }
}
