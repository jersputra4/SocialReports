import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Report } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AuditAction } from '../common/audit/audit-actions';
import { FetcherClient } from '../fetcher-client/fetcher.client';
import { LegalService } from '../legal/legal.service';
import { PlatformsService } from '../platforms/platforms.service';
import { PoliciesService } from '../policies/policies.service';
import { PricingService } from '../pricing/pricing.service';
import { generateReportCode } from '../common/utils/codes.util';
import { calculatePrice } from '../common/utils/money.util';
import { EDITABLE_STATUSES, ReportStatusValue } from './state-machine';
import { ReportTransitionService } from './report-transition.service';
import {
  CreateReportDto,
  SetLegalBasisDto,
  SetPoliciesDto,
  UpdateReportDto,
} from './dto/report.dto';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly transitions: ReportTransitionService,
    private readonly pricing: PricingService,
    private readonly policies: PoliciesService,
    private readonly legal: LegalService,
    private readonly platforms: PlatformsService,
    private readonly fetcher: FetcherClient,
  ) {}

  // ------------------------------------------------------------ pembacaan ---

  /**
   * Mengambil report milik pengguna.
   *
   * Report milik orang lain menghasilkan 404, bukan 403, sehingga keberadaan
   * objek tidak dapat dipetakan dengan menebak kode (BRD 4.5, AC-07).
   */
  async findForUser(userId: string, reportCode: string) {
    const report = await this.prisma.report.findFirst({
      where: { reportCode, userId },
      include: this.detailInclude(),
    });

    if (!report) {
      await this.audit.record({
        action: AuditAction.ACCESS_DENIED,
        entityType: 'report',
        entityId: reportCode,
      });
      throw new NotFoundException('Report tidak ditemukan.');
    }

    return this.toDetail(report);
  }

  async findForAdmin(reportCode: string) {
    const report = await this.prisma.report.findUnique({
      where: { reportCode },
      include: {
        ...this.detailInclude(),
        user: { select: { id: true, email: true, fullName: true } },
      },
    });
    if (!report) throw new NotFoundException('Report tidak ditemukan.');
    return this.toDetail(report);
  }

  async listForUser(
    userId: string,
    query: { status?: string; page?: number; pageSize?: number },
  ) {
    return this.list({ userId }, query);
  }

  async listForAdmin(query: {
    status?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  }) {
    const where: Prisma.ReportWhereInput = {};
    if (query.search) {
      where.OR = [
        { reportCode: { contains: query.search.toUpperCase() } },
        { user: { email: { contains: query.search.toLowerCase() } } },
      ];
    }
    return this.list(where, query);
  }

  private async list(
    baseWhere: Prisma.ReportWhereInput,
    query: { status?: string; page?: number; pageSize?: number },
  ) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));

    const where: Prisma.ReportWhereInput = { ...baseWhere };
    if (query.status && query.status !== 'ALL') {
      where.status = query.status as Prisma.ReportWhereInput['status'];
    }

    const [total, rows] = await Promise.all([
      this.prisma.report.count({ where }),
      this.prisma.report.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          actionType: true,
          package: true,
          targetSnapshot: { select: { originalUrl: true, platformId: true } },
          user: { select: { email: true, fullName: true } },
          _count: { select: { evidences: true, proofs: true } },
        },
      }),
    ]);

    return {
      total,
      page,
      pageSize,
      items: rows.map((row) => ({
        reportCode: row.reportCode,
        status: row.status,
        actionType: row.actionType.code,
        packageQuantity: row.packageQuantity,
        platformName: row.platformNameSnapshot,
        totalAmount: row.totalAmountSnapshot?.toString() ?? null,
        targetUrl: row.targetSnapshot?.originalUrl ?? null,
        evidenceCount: row._count.evidences,
        proofCount: row._count.proofs,
        owner: row.user ? { email: row.user.email, fullName: row.user.fullName } : undefined,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
    };
  }

  private detailInclude() {
    return {
      actionType: true,
      package: true,
      targetSnapshot: true,
      policies: true,
      legalBasis: true,
      evidences: {
        select: {
          id: true,
          fileName: true,
          fileType: true,
          fileSize: true,
          fileHash: true,
          caption: true,
          scanStatus: true,
          createdAt: true,
        },
      },
      statusHistory: { orderBy: { occurredAt: 'asc' as const } },
      reviewDecisions: { orderBy: { decidedAt: 'desc' as const } },
      complaints: { orderBy: { submittedAt: 'desc' as const } },
      payments: { orderBy: { createdAt: 'desc' as const } },
      invoices: { orderBy: { issuedAt: 'desc' as const } },
      documents: { orderBy: { version: 'desc' as const } },
    };
  }

  /** BigInt tidak dapat diserialisasi JSON; uang dikirim sebagai string. */
  /**
   * Tipe kembalian ditulis eksplisit. Tanpa anotasi ini TypeScript menyimpulkan
   * tipe literal dari objek yang dibentuk, sehingga properti hasil spread
   * (termasuk `status`) hilang bagi pemanggil.
   */
  private toDetail(report: Record<string, any>): Record<string, any> {
    return {
      ...report,
      id: undefined,
      userId: undefined,
      unitPriceSnapshot: report.unitPriceSnapshot?.toString() ?? null,
      subtotalSnapshot: report.subtotalSnapshot?.toString() ?? null,
      taxAmountSnapshot: report.taxAmountSnapshot?.toString() ?? null,
      totalAmountSnapshot: report.totalAmountSnapshot?.toString() ?? null,
      payments: (report.payments ?? []).map((payment: Record<string, any>) => ({
        ...payment,
        id: undefined,
        subtotal: payment.subtotal.toString(),
        taxAmount: payment.taxAmount.toString(),
        totalAmount: payment.totalAmount.toString(),
        paidAmount: payment.paidAmount.toString(),
        overpaidAmount: payment.overpaidAmount.toString(),
      })),
      invoices: (report.invoices ?? []).map((invoice: Record<string, any>) => ({
        ...invoice,
        id: undefined,
        subtotal: invoice.subtotal.toString(),
        taxAmount: invoice.taxAmount.toString(),
        total: invoice.total.toString(),
      })),
    };
  }

  // ------------------------------------------------------------- pembuatan --

  async createDraft(userId: string, dto: CreateReportDto): Promise<{ reportCode: string }> {
    const [actionType, pkg] = await Promise.all([
      this.prisma.actionType.findFirst({ where: { id: dto.actionTypeId, active: true } }),
      this.prisma.package.findFirst({ where: { id: dto.packageId, active: true } }),
    ]);

    if (!actionType) throw new BadRequestException('Jenis tindakan tidak tersedia.');
    if (!pkg) throw new BadRequestException('Paket tidak tersedia.');

    const targetSnapshot = await this.buildTargetSnapshot(dto.targetUrl);

    const report = await this.prisma.report.create({
      data: {
        reportCode: await this.allocateReportCode(),
        userId,
        actionTypeId: actionType.id,
        packageId: pkg.id,
        packageQuantity: pkg.quantity,
        targetSnapshotId: targetSnapshot.id,
        description: dto.description,
        status: 'DRAFT',
      },
    });

    await this.audit.record({
      action: AuditAction.CREATE_REPORT,
      entityType: 'report',
      entityId: report.reportCode,
      actorId: userId,
      after: {
        actionType: actionType.code,
        packageQuantity: pkg.quantity,
        fetchStatus: targetSnapshot.fetchStatus,
      },
    });

    return { reportCode: report.reportCode };
  }

  /**
   * Kode report acak. Tabrakan sangat tidak mungkin, tetapi tetap ditangani:
   * unique index adalah penentunya, bukan pemeriksaan sebelumnya.
   */
  private async allocateReportCode(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = generateReportCode();
      const existing = await this.prisma.report.findUnique({
        where: { reportCode: code },
        select: { id: true },
      });
      if (!existing) return code;
    }
    throw new ConflictException('Gagal membuat kode report. Silakan coba lagi.');
  }

  /**
   * Membuat salinan data target.
   *
   * Pengambilan metadata boleh gagal — konten dapat dihapus, atau platform
   * menolak permintaan. Report tetap dapat dibuat dengan `fetch_status`
   * MANUAL/FAILED, dan pengguna melengkapi keterangan sendiri (BRD 4.2 poin 9).
   */
  private async buildTargetSnapshot(targetUrl: string) {
    const allowedDomains = await this.platforms.allowedDomains();

    let host = '';
    try {
      host = new URL(targetUrl).hostname;
    } catch {
      throw new BadRequestException('URL target tidak dapat dibaca.');
    }

    const platform = await this.platforms.matchByHost(host);
    if (!platform) {
      throw new BadRequestException(
        'Platform tidak didukung. Sistem hanya menerima tautan Facebook, Instagram, TikTok, X, dan YouTube.',
      );
    }

    const result = await this.fetcher.fetchMetadata(targetUrl, allowedDomains);

    return this.prisma.targetSnapshot.create({
      data: {
        originalUrl: targetUrl,
        canonicalUrl: result.canonicalUrl?.slice(0, 2048),
        platformId: platform.id,
        metadataJson: (result.metadata ?? {}) as Prisma.InputJsonValue,
        fetchedAt: result.status === 'FAILED' ? null : new Date(),
        fetchStatus: result.status === 'OK' ? 'OK' : result.status === 'PARTIAL' ? 'PARTIAL' : 'FAILED',
        fetchError: result.error?.slice(0, 512),
      },
    });
  }

  // ------------------------------------------------------------- penyuntingan

  private async loadEditable(userId: string, reportCode: string): Promise<Report> {
    const report = await this.prisma.report.findFirst({ where: { reportCode, userId } });
    if (!report) throw new NotFoundException('Report tidak ditemukan.');

    if (!EDITABLE_STATUSES.includes(report.status as ReportStatusValue)) {
      throw new ConflictException(
        `Report berstatus ${report.status} tidak dapat diubah. Isinya sudah dibekukan.`,
      );
    }
    return report;
  }

  async update(userId: string, reportCode: string, dto: UpdateReportDto) {
    const report = await this.loadEditable(userId, reportCode);
    const data: Prisma.ReportUpdateInput = {};

    if (dto.description !== undefined) data.description = dto.description;

    if (dto.packageId) {
      const pkg = await this.prisma.package.findFirst({
        where: { id: dto.packageId, active: true },
      });
      if (!pkg) throw new BadRequestException('Paket tidak tersedia.');
      data.package = { connect: { id: pkg.id } };
      data.packageQuantity = pkg.quantity;
    }

    if (dto.actionTypeId) {
      const actionType = await this.prisma.actionType.findFirst({
        where: { id: dto.actionTypeId, active: true },
      });
      if (!actionType) throw new BadRequestException('Jenis tindakan tidak tersedia.');
      data.actionType = { connect: { id: actionType.id } };
    }

    if (dto.targetUrl) {
      const snapshot = await this.buildTargetSnapshot(dto.targetUrl);
      data.targetSnapshot = { connect: { id: snapshot.id } };
    }

    const updated = await this.prisma.report.update({ where: { id: report.id }, data });

    await this.audit.record({
      action: AuditAction.UPDATE_REPORT,
      entityType: 'report',
      entityId: report.reportCode,
      actorId: userId,
      before: { description: report.description, packageQuantity: report.packageQuantity },
      after: { description: updated.description, packageQuantity: updated.packageQuantity },
    });

    return { reportCode: updated.reportCode };
  }

  async setPolicies(userId: string, reportCode: string, dto: SetPoliciesDto) {
    const report = await this.loadEditable(userId, reportCode);

    const resolved = await Promise.all(
      dto.policies.map(async (selection) => {
        if (selection.policyVersionId) {
          const snapshot = await this.policies.resolveForSnapshot(selection.policyVersionId);
          return {
            policyId: snapshot.policyId,
            policyVersionId: snapshot.policyVersionId,
            nameSnapshot: snapshot.policyName,
            versionSnapshot: snapshot.policyVersion,
            textSnapshot: snapshot.policyText,
            otherReason: null as string | null,
            platformName: snapshot.platformName,
          };
        }
        if (!selection.otherReason) {
          throw new BadRequestException(
            'Pilih kebijakan platform atau isi alasan pada pilihan "Lainnya".',
          );
        }
        return {
          policyId: null,
          policyVersionId: null,
          nameSnapshot: 'Lainnya',
          versionSnapshot: null,
          textSnapshot: null,
          otherReason: selection.otherReason,
          platformName: null,
        };
      }),
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.reportPolicy.deleteMany({ where: { reportId: report.id } });
      for (const item of resolved) {
        await tx.reportPolicy.create({
          data: {
            reportId: report.id,
            policyId: item.policyId,
            policyVersionId: item.policyVersionId,
            nameSnapshot: item.nameSnapshot,
            versionSnapshot: item.versionSnapshot,
            textSnapshot: item.textSnapshot,
            otherReason: item.otherReason,
          },
        });
      }

      await this.audit.record(
        {
          action: AuditAction.UPDATE_REPORT,
          entityType: 'report',
          entityId: report.reportCode,
          actorId: userId,
          after: { policies: resolved.map((item) => item.nameSnapshot) },
        },
        tx,
      );
    });

    return { count: resolved.length };
  }

  async setLegalBasis(userId: string, reportCode: string, dto: SetLegalBasisDto) {
    const report = await this.loadEditable(userId, reportCode);

    const resolved = await Promise.all(
      dto.legalBasis.map(async (selection) => {
        if (selection.paragraphId) {
          const snapshot = await this.legal.resolveForSnapshot(selection.paragraphId);
          return {
            paragraphId: snapshot.paragraphId,
            lawNameSnapshot: snapshot.lawName,
            lawVersionSnapshot: snapshot.lawVersion,
            articleNumberSnapshot: snapshot.articleNumber,
            paragraphNumberSnapshot: snapshot.paragraphNumber,
            textSnapshot: snapshot.text,
            explanationSnapshot: snapshot.explanation,
            otherReason: null as string | null,
          };
        }
        if (!selection.otherReason) {
          throw new BadRequestException(
            'Pilih dasar hukum atau isi alasan pada pilihan "Lainnya".',
          );
        }
        return {
          paragraphId: null,
          lawNameSnapshot: 'Lainnya',
          lawVersionSnapshot: null,
          articleNumberSnapshot: null,
          paragraphNumberSnapshot: null,
          textSnapshot: null,
          explanationSnapshot: null,
          otherReason: selection.otherReason,
        };
      }),
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.reportLegalBasis.deleteMany({ where: { reportId: report.id } });
      for (const item of resolved) {
        await tx.reportLegalBasis.create({ data: { reportId: report.id, ...item } });
      }
      await this.audit.record(
        {
          action: AuditAction.UPDATE_REPORT,
          entityType: 'report',
          entityId: report.reportCode,
          actorId: userId,
          after: { legalBasis: resolved.map((item) => item.lawNameSnapshot) },
        },
        tx,
      );
    });

    return { count: resolved.length };
  }

  // --------------------------------------------------------------- snapshot --

  /**
   * Membekukan seluruh nilai yang akan dipakai selamanya oleh report ini:
   * harga, tarif pajak, kebijakan, dasar hukum, dan nama platform.
   *
   * Setelah `snapshot_sealed_at` terisi, trigger database menolak perubahan
   * pada kolom-kolom tersebut (migrasi 0003) — itulah yang membuat AC-12 dan
   * AC-13 berlaku bahkan bila ada bug di lapisan aplikasi.
   */
  async sealSnapshot(tx: Prisma.TransactionClient, reportId: string): Promise<Report> {
    const report = await tx.report.findUniqueOrThrow({
      where: { id: reportId },
      include: {
        policies: { orderBy: { createdAt: 'asc' } },
        legalBasis: { orderBy: { createdAt: 'asc' } },
        targetSnapshot: { include: { platform: true } },
      },
    });

    if (report.policies.length === 0) {
      throw new BadRequestException('Pilih minimal satu kebijakan platform.');
    }
    if (report.legalBasis.length === 0) {
      throw new BadRequestException('Pilih minimal satu dasar hukum.');
    }
    if (!report.targetSnapshot) {
      throw new BadRequestException('Target report belum lengkap.');
    }

    const effective = await this.pricing.effectiveAt(new Date(), tx);
    const price = calculatePrice(effective.unitPrice, report.packageQuantity, effective.taxRateBp);

    const primaryPolicy = report.policies[0];
    const primaryLegal = report.legalBasis[0];

    return tx.report.update({
      where: { id: report.id },
      data: {
        unitPriceSnapshot: price.unitPrice,
        subtotalSnapshot: price.subtotal,
        taxRateBpSnapshot: price.taxRateBp,
        taxAmountSnapshot: price.taxAmount,
        totalAmountSnapshot: price.totalAmount,

        platformNameSnapshot: report.targetSnapshot.platform?.name ?? null,
        policyNameSnapshot: primaryPolicy.nameSnapshot,
        policyVersionSnapshot: primaryPolicy.versionSnapshot,
        policyTextSnapshot: primaryPolicy.textSnapshot,
        otherPolicyReason: primaryPolicy.otherReason,

        lawNameSnapshot: primaryLegal.lawNameSnapshot,
        lawVersionSnapshot: primaryLegal.lawVersionSnapshot,
        articleNumberSnapshot: primaryLegal.articleNumberSnapshot,
        paragraphNumberSnapshot: primaryLegal.paragraphNumberSnapshot,
        textSnapshot: primaryLegal.textSnapshot,
        explanationSnapshot: primaryLegal.explanationSnapshot,
        otherLegalReason: primaryLegal.otherReason,

        snapshotSealedAt: new Date(),
      },
    });
  }

  // ---------------------------------------------------------- aksi pengguna --

  async resubmitAfterRevision(userId: string, reportCode: string) {
    const report = await this.prisma.report.findFirst({ where: { reportCode, userId } });
    if (!report) throw new NotFoundException('Report tidak ditemukan.');

    // BRD 7.2 baris 16: kembali ke antrean review TANPA pembayaran baru.
    await this.transitions.transition({
      reportId: report.id,
      to: 'WAITING_REVIEW',
      actor: 'USER',
      actorId: userId,
      actorRole: 'user',
      reason: 'Perbaikan dikirim ulang oleh pengguna',
    });

    return { reportCode, status: 'WAITING_REVIEW' };
  }

  async cancel(userId: string, reportCode: string, reason?: string) {
    const report = await this.prisma.report.findFirst({ where: { reportCode, userId } });
    if (!report) throw new NotFoundException('Report tidak ditemukan.');

    await this.transitions.transition({
      reportId: report.id,
      to: 'CANCELLED',
      actor: 'USER',
      actorId: userId,
      actorRole: 'user',
      reason: reason ?? 'Dibatalkan oleh pengguna',
    });

    return { reportCode, status: 'CANCELLED' };
  }

  async resolveOwnedReport(userId: string, reportCode: string): Promise<Report> {
    const report = await this.prisma.report.findFirst({ where: { reportCode, userId } });
    if (!report) {
      await this.audit.record({
        action: AuditAction.ACCESS_DENIED,
        entityType: 'report',
        entityId: reportCode,
      });
      throw new NotFoundException('Report tidak ditemukan.');
    }
    return report;
  }

  async resolveAnyReport(reportCode: string): Promise<Report> {
    const report = await this.prisma.report.findUnique({ where: { reportCode } });
    if (!report) throw new NotFoundException('Report tidak ditemukan.');
    return report;
  }
}
