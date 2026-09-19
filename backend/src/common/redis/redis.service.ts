import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfig, CONFIG_TOKEN } from '../config/configuration';

/**
 * Redis dipakai untuk cache sesi, rate limiting, dan antrean BullMQ.
 *
 * Redis BUKAN sumber kebenaran (BRD 3.3): kehilangan Redis hanya menghilangkan
 * cache dan penghitung rate limit — event notifikasi tetap aman di tabel
 * outbox_events dan sesi tetap ada di user_sessions.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(@Inject(CONFIG_TOKEN) config: AppConfig) {
    this.client = new Redis(config.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: false,
    });
    this.client.on('error', (error) => this.logger.error(`Redis: ${error.message}`));
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => undefined);
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch {
      return null; // cache miss lebih baik daripada permintaan gagal
    }
  }

  async setEx(key: string, value: string, ttlSeconds: number): Promise<void> {
    try {
      await this.client.set(key, value, 'EX', Math.max(1, Math.floor(ttlSeconds)));
    } catch (error) {
      this.logger.warn(`Gagal menulis cache ${key}: ${(error as Error).message}`);
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      await this.client.del(...keys);
    } catch {
      /* diabaikan: cache akan kedaluwarsa sendiri */
    }
  }

  /**
   * Penghitung jendela tetap untuk rate limit (NFR-09).
   * Mengembalikan jumlah permintaan pada jendela berjalan.
   * Bila Redis tidak tersedia, mengembalikan 0 sehingga permintaan diteruskan —
   * ketersediaan layanan lebih diutamakan daripada rate limit yang ketat, dan
   * WAF di tepi tetap membatasi (infrastructure/nginx).
   */
  async incrementWindow(key: string, windowSeconds: number): Promise<number> {
    try {
      const pipeline = this.client.multi();
      pipeline.incr(key);
      pipeline.expire(key, windowSeconds, 'NX');
      const result = await pipeline.exec();
      const count = result?.[0]?.[1];
      return typeof count === 'number' ? count : 0;
    } catch (error) {
      this.logger.warn(`Rate limit tidak dapat dihitung: ${(error as Error).message}`);
      return 0;
    }
  }

  async ttl(key: string): Promise<number> {
    try {
      return await this.client.ttl(key);
    } catch {
      return -1;
    }
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }
}
