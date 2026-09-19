import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function toJSON(this: bigint) {
  return this.toString();
};

async function bootstrap(): Promise<void> {
  const logger = new Logger('Worker');

  // Worker tidak mendengarkan port mana pun: ia hanya mengambil pekerjaan.
  // Ini sekaligus memenuhi aturan zona App pada BRD 3.2 — worker tidak
  // menerima koneksi masuk dari luar.
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });

  app.enableShutdownHooks();
  logger.log('Worker siap: antrean pembayaran, dokumen, outbox, dan pekerjaan terjadwal aktif.');

  const shutdown = async (signal: string): Promise<void> => {
    logger.log(`Menerima ${signal}, menutup worker...`);
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Worker gagal start:', error);
  process.exit(1);
});
