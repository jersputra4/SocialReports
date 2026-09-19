import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfig, CONFIG_TOKEN } from './common/config/configuration';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

/**
 * Uang disimpan sebagai BigInt agar tidak ada galat pembulatan biner.
 * JSON tidak mengenal BigInt, jadi nilainya dikirim sebagai string; frontend
 * memperlakukannya sebagai string dan memformatnya sendiri.
 */
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function toJSON(this: bigint) {
  return this.toString();
};

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Body mentah dibutuhkan untuk memverifikasi tanda tangan webhook atas
    // byte yang benar-benar dikirim penyedia pembayaran.
    rawBody: true,
    bufferLogs: true,
  });

  const config = app.get<AppConfig>(CONFIG_TOKEN);

  app.setGlobalPrefix('api/v1');
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: false, // CSP dipasang pada respons halaman oleh nginx
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      validationError: { target: false, value: false },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter(config.isProduction));

  // Frontend dilayani dari origin yang sama lewat reverse proxy, sehingga CORS
  // tidak diperlukan di production. Untuk `npm run dev` di mesin pengembang,
  // origin Vite diizinkan secara eksplisit.
  if (!config.isProduction) {
    app.enableCors({
      origin: ['http://localhost:5173', 'http://127.0.0.1:5173', config.publicUrl],
      credentials: true,
      allowedHeaders: ['content-type', 'x-csrf-token', 'x-request-id'],
    });
  }

  app.enableShutdownHooks();

  await app.listen(config.port, '0.0.0.0');
  logger.log(`API siap pada port ${config.port} (env ${config.env})`);
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Aplikasi gagal start:', error);
  process.exit(1);
});
