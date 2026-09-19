import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Klien database.
 *
 * Primary key tidak diisi di sini: seluruh kolom id memakai default
 * uuid_generate_v7() di database (migrasi 0005), sehingga penyisipan lewat
 * jalur mana pun — aplikasi, migrasi, skrip pemeliharaan — tetap konsisten.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();

    // Log query lambat membantu memenuhi NFR-01/NFR-02.
    (this as unknown as { $on: (e: string, cb: (payload: unknown) => void) => void }).$on(
      'warn',
      (payload) => this.logger.warn(JSON.stringify(payload)),
    );
    (this as unknown as { $on: (e: string, cb: (payload: unknown) => void) => void }).$on(
      'error',
      (payload) => this.logger.error(JSON.stringify(payload)),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Transaksi serializable untuk alur yang tidak boleh kehilangan update —
   * pemrosesan webhook pembayaran dan transisi status.
   */
  runSerializable<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.$transaction(fn, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 15_000,
    });
  }
}
