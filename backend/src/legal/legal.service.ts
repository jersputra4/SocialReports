import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AuditAction } from '../common/audit/audit-actions';

export interface LegalSelection {
  paragraphId: string;
  lawName: string;
  lawVersion: string;
  articleNumber: string;
  paragraphNumber: string;
  text: string;
  explanation: string | null;
}

/**
 * Master dasar hukum: UU -> versi -> pasal -> ayat.
 *
 * Sama seperti kebijakan platform, report menyimpan salinan teks ayat yang
 * dipilih sehingga perubahan atau pencabutan pasal di kemudian hari tidak
 * mengubah dokumen yang sudah dibuat.
 */
@Injectable()
export class LegalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listLaws(at: Date = new Date()) {
    const laws = await this.prisma.law.findMany({
      where: { archivedAt: null },
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

    return laws
      .filter((law) => law.versions.length > 0)
      .map((law) => ({
        lawId: law.id,
        code: law.code,
        name: law.name,
        shortName: law.shortName,
        versionId: law.versions[0].id,
        version: law.versions[0].version,
      }));
  }

  async listArticles(legalVersionId: string) {
    const articles = await this.prisma.legalArticle.findMany({
      where: { legalVersionId },
      orderBy: { number: 'asc' },
      include: { paragraphs: { orderBy: { number: 'asc' } } },
    });

    return articles.map((article) => ({
      articleId: article.id,
      number: article.number,
      title: article.title,
      paragraphs: article.paragraphs.map((p) => ({
        paragraphId: p.id,
        number: p.number,
        text: p.text,
        explanation: p.explanation,
      })),
    }));
  }

  async resolveForSnapshot(paragraphId: string): Promise<LegalSelection> {
    const paragraph = await this.prisma.legalParagraph.findUnique({
      where: { id: paragraphId },
      include: { article: { include: { legalVersion: { include: { law: true } } } } },
    });

    if (!paragraph || paragraph.article.legalVersion.law.archivedAt) {
      throw new NotFoundException('Dasar hukum tidak ditemukan.');
    }

    return {
      paragraphId: paragraph.id,
      lawName: paragraph.article.legalVersion.law.name,
      lawVersion: paragraph.article.legalVersion.version,
      articleNumber: paragraph.article.number,
      paragraphNumber: paragraph.number,
      text: paragraph.text,
      explanation: paragraph.explanation,
    };
  }

  // --------------------------------------------------------------- admin ----

  async createLaw(input: {
    code: string;
    name: string;
    shortName?: string;
    version: string;
    effectiveFrom: Date;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const law = await tx.law.create({
        data: { code: input.code, name: input.name, shortName: input.shortName },
      });
      const version = await tx.legalVersion.create({
        data: { lawId: law.id, version: input.version, effectiveFrom: input.effectiveFrom },
      });
      await this.audit.record(
        {
          action: AuditAction.LEGAL_CREATE,
          entityType: 'law',
          entityId: law.id,
          after: { code: input.code, version: input.version },
        },
        tx,
      );
      return { lawId: law.id, versionId: version.id };
    });
  }

  async addArticle(input: {
    legalVersionId: string;
    number: string;
    title?: string;
    paragraphs: Array<{ number: string; text: string; explanation?: string }>;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const article = await tx.legalArticle.create({
        data: {
          legalVersionId: input.legalVersionId,
          number: input.number,
          title: input.title,
        },
      });

      for (const paragraph of input.paragraphs) {
        await tx.legalParagraph.create({
          data: {
            articleId: article.id,
            number: paragraph.number,
            text: paragraph.text,
            explanation: paragraph.explanation,
          },
        });
      }

      await this.audit.record(
        {
          action: AuditAction.LEGAL_UPDATE,
          entityType: 'legal_article',
          entityId: article.id,
          after: { number: input.number, paragraphs: input.paragraphs.length },
        },
        tx,
      );

      return { articleId: article.id };
    });
  }

  async archiveLaw(lawId: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.law.update({ where: { id: lawId }, data: { archivedAt: new Date() } });
      await this.audit.record(
        { action: AuditAction.LEGAL_ARCHIVE, entityType: 'law', entityId: lawId },
        tx,
      );
    });
  }

  async listAllForAdmin() {
    return this.prisma.law.findMany({
      orderBy: { name: 'asc' },
      include: {
        versions: {
          orderBy: { effectiveFrom: 'desc' },
          include: { articles: { include: { paragraphs: true } } },
        },
        amendments: { orderBy: { issuedAt: 'desc' } },
      },
    });
  }
}
