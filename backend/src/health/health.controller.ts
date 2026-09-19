import { Controller, Get, Inject } from '@nestjs/common';
import { AppConfig, CONFIG_TOKEN } from '../common/config/configuration';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { FetcherClient } from '../fetcher-client/fetcher.client';
import { StorageService } from '../storage/storage.service';
import { Public } from '../common/security/decorators';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
    private readonly fetcher: FetcherClient,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
  ) {}

  /** Liveness: dipakai orchestrator, sengaja tidak menyentuh dependensi. */
  @Public()
  @Get()
  live() {
    return { status: 'ok', service: 'api', env: this.config.env };
  }

  /** Readiness: memeriksa seluruh dependensi (NFR-11). */
  @Public()
  @Get('ready')
  async ready() {
    const [database, redis, storage, fetcher] = await Promise.all([
      this.prisma
        .$queryRaw`SELECT 1`
        .then(() => true)
        .catch(() => false),
      this.redis.ping(),
      this.storage.healthy(),
      this.fetcher.healthy(),
    ]);

    // Fetcher bukan dependensi kritis: bila mati, report tetap dapat dibuat
    // dengan konfirmasi manual (BRD 4.2 poin 9).
    const ready = database && redis && storage;

    return {
      status: ready ? 'ready' : 'degraded',
      checks: { database, redis, storage, fetcher },
    };
  }
}
