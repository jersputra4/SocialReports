import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AuditAction } from '../common/audit/audit-actions';

export interface PolicySelection {
  policyId: string;
  policyVersionId: string;
  policyName: string;
  policyVersion: string;
  policyText: string;
  platformName: string;
}

/**
 * Master kebijakan platform beserta versinya.
 *
 * Report menyimpan salinan teks kebijakan (snapshot), bukan hanya referensi.
 * Karena itu perubahan master di kemudian hari tidak mengubah isi report yang
 * sudah dibuat — yang dibuktikan AC-13.
 */
@Injectable()
export class PoliciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Kebijakan aktif satu platform beserta versi yang sedang berlaku. */
  async listByPlatform(platformId: string, at: Date = new Date()) {
    const policies = await this.prisma.platformPolicy.findMany({
      where: { platformId, archivedAt: null },
      orderBy: { name: 'asc' },
      include: {
        versions: {
          where: {
            effectiveFrom: { lte: at },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
          },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
        },
      },
    });

    return policies
      .filter((policy) => policy.versions.length > 0)
      .map((policy) => ({
        policyId: policy.id,
        code: policy.code,
        name: policy.name,
        category: policy.category,
        versionId: policy.versions[0].id,
        version: policy.versions[0].version,
        text: policy.versions[0].text,
        sourceUrl: policy.versions[0].sourceUrl,
      }));
  }

  /** Mengambil data untuk dibekukan ke dalam report. */
  async resolveForSnapshot(policyVersionId: string): Promise<PolicySelection> {
    const version = await this.prisma.platformPolicyVersion.findUnique({
      where: { id: policyVersionId },
      include: { policy: { include: { platform: true } } },
    });

    if (!version || version.policy.archivedAt) {
      throw new NotFoundException('Kebijakan platform tidak ditemukan.');
    }

    return {
      policyId: version.policyId,
      policyVersionId: version.id,
      policyName: version.policy.name,
      policyVersion: version.version,
      policyText: version.text,
      platformName: version.policy.platform.name,
    };
  }

  // --------------------------------------------------------------- admin ----

  async createPolicy(input: {
    platformId: string;
    code: string;
    name: string;
    category?: string;
    version: string;
    text: string;
    sourceUrl?: string;
    effectiveFrom: Date;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const policy = await tx.platformPolicy.create({
        data: {
          platformId: input.platformId,
          code: input.code,
          name: input.name,
          category: input.category,
        },
      });

      const version = await tx.platformPolicyVersion.create({
        data: {
          policyId: policy.id,
          version: input.version,
          text: input.text,
          sourceUrl: input.sourceUrl,
          effectiveFrom: input.effectiveFrom,
        },
      });

      await this.audit.record(
        {
          action: AuditAction.POLICY_CREATE,
          entityType: 'platform_policy',
          entityId: policy.id,
          after: { code: input.code, name: input.name, version: input.version },
        },
        tx,
      );

      return { policyId: policy.id, versionId: version.id };
    });
  }

  /**
   * Menambahkan versi baru dan menutup versi sebelumnya.
   * Versi lama tetap tersimpan karena masih dirujuk report lama.
   */
  async addVersion(input: {
    policyId: string;
    version: string;
    text: string;
    sourceUrl?: string;
    effectiveFrom: Date;
  }) {
    if (input.effectiveFrom.getTime() < Date.now() - 60_000) {
      throw new BadRequestException('Versi kebijakan tidak dapat berlaku surut.');
    }

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.platformPolicyVersion.findFirst({
        where: { policyId: input.policyId, effectiveTo: null },
        orderBy: { effectiveFrom: 'desc' },
      });

      if (current) {
        await tx.platformPolicyVersion.update({
          where: { id: current.id },
          data: { effectiveTo: input.effectiveFrom },
        });
      }

      const version = await tx.platformPolicyVersion.create({
        data: {
          policyId: input.policyId,
          version: input.version,
          text: input.text,
          sourceUrl: input.sourceUrl,
          effectiveFrom: input.effectiveFrom,
        },
      });

      await this.audit.record(
        {
          action: AuditAction.POLICY_UPDATE,
          entityType: 'platform_policy',
          entityId: input.policyId,
          before: current ? { version: current.version } : undefined,
          after: { version: input.version, effectiveFrom: input.effectiveFrom.toISOString() },
        },
        tx,
      );

      return { versionId: version.id };
    });
  }

  async archive(policyId: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.platformPolicy.update({
        where: { id: policyId },
        data: { archivedAt: new Date() },
      });
      await this.audit.record(
        { action: AuditAction.POLICY_ARCHIVE, entityType: 'platform_policy', entityId: policyId },
        tx,
      );
    });
  }

  async listAllForAdmin() {
    return this.prisma.platformPolicy.findMany({
      orderBy: [{ platformId: 'asc' }, { name: 'asc' }],
      include: {
        platform: { select: { code: true, name: true } },
        versions: { orderBy: { effectiveFrom: 'desc' }, take: 5 },
      },
    });
  }
}
