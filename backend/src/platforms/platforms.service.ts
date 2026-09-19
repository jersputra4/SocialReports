import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

/**
 * Master platform media sosial.
 *
 * Kolom `domains` merangkap sebagai allowlist pengambilan metadata (BRD 4.2):
 * Metadata Fetcher hanya menerima host yang tercantum di sini, sehingga
 * menambah platform baru cukup lewat data.
 */
@Injectable()
export class PlatformsService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.socialPlatform.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      select: { id: true, code: true, name: true, domains: true, reportUrl: true },
    });
  }

  /** Allowlist gabungan yang dikirim ke Metadata Fetcher. */
  async allowedDomains(): Promise<string[]> {
    const platforms = await this.prisma.socialPlatform.findMany({
      where: { active: true },
      select: { domains: true },
    });
    return [...new Set(platforms.flatMap((p) => p.domains))];
  }

  /** Mencocokkan host dengan platform. Mengembalikan null bila tidak dikenal. */
  async matchByHost(host: string): Promise<{ id: string; code: string; name: string } | null> {
    const normalized = host.toLowerCase().replace(/^www\./, '');
    const platforms = await this.prisma.socialPlatform.findMany({
      where: { active: true },
      select: { id: true, code: true, name: true, domains: true },
    });

    for (const platform of platforms) {
      for (const domain of platform.domains) {
        const d = domain.toLowerCase();
        if (normalized === d || normalized.endsWith(`.${d}`)) {
          return { id: platform.id, code: platform.code, name: platform.name };
        }
      }
    }
    return null;
  }

  async actionTypes() {
    return this.prisma.actionType.findMany({
      where: { active: true },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true },
    });
  }
}
