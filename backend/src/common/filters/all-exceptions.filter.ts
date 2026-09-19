import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';
import { getRequestContext } from '../context/request-context';
import { AuthenticatedRequest } from '../security/auth.types';
import { TransitionNotAllowedError } from '../../reports/state-machine';

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
  requestId?: string;
  details?: unknown;
}

/**
 * Penanganan galat terpusat.
 *
 * Dua hal yang dijaga:
 *   1. Pesan galat internal tidak bocor ke klien pada mode production.
 *   2. Setiap respons galat membawa requestId sehingga pengguna dapat
 *      menyebutkannya saat melapor dan tim dapat menemukan log terkait.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpException');

  constructor(private readonly isProduction: boolean) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<AuthenticatedRequest>();
    const requestId = getRequestContext()?.requestId;

    const body = this.toBody(exception);
    body.requestId = requestId;

    if (body.statusCode >= 500) {
      this.logger.error(
        `${request.method} ${request.url} -> ${body.statusCode} [${requestId}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(
        `${request.method} ${request.url} -> ${body.statusCode} [${requestId}] ${JSON.stringify(body.message)}`,
      );
    }

    response.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown): ErrorBody {
    // Transisi status di luar tabel 7.2 -> 409 Conflict (AC-23).
    if (exception instanceof TransitionNotAllowedError) {
      return {
        statusCode: HttpStatus.CONFLICT,
        error: 'TransitionNotAllowed',
        message: exception.message,
        details: { from: exception.from, to: exception.to },
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      if (typeof payload === 'string') {
        return { statusCode: status, error: exception.name, message: payload };
      }

      const record = payload as Record<string, unknown>;
      return {
        statusCode: status,
        error: (record.error as string) ?? exception.name,
        message: (record.message as string | string[]) ?? exception.message,
        details: record.retryAfterSeconds !== undefined
          ? { retryAfterSeconds: record.retryAfterSeconds }
          : undefined,
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.fromPrisma(exception);
    }

    // Pelanggaran trigger/constraint database yang tidak punya kode Prisma khusus.
    if (
      exception instanceof Prisma.PrismaClientUnknownRequestError ||
      (exception instanceof Error && /integrity_constraint_violation/.test(exception.message))
    ) {
      return {
        statusCode: HttpStatus.CONFLICT,
        error: 'IntegrityConstraint',
        message: this.isProduction
          ? 'Operasi ditolak karena melanggar aturan data.'
          : (exception as Error).message,
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'InternalServerError',
      message: this.isProduction
        ? 'Terjadi kesalahan pada sistem. Silakan coba lagi.'
        : String((exception as Error)?.message ?? exception),
    };
  }

  private fromPrisma(error: Prisma.PrismaClientKnownRequestError): ErrorBody {
    switch (error.code) {
      case 'P2002':
        return {
          statusCode: HttpStatus.CONFLICT,
          error: 'DuplicateValue',
          message: 'Data dengan nilai tersebut sudah ada.',
        };
      case 'P2025':
        return {
          statusCode: HttpStatus.NOT_FOUND,
          error: 'NotFound',
          message: 'Data tidak ditemukan.',
        };
      case 'P2003':
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          error: 'InvalidReference',
          message: 'Referensi data tidak valid.',
        };
      default:
        return {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          error: 'DatabaseError',
          message: this.isProduction
            ? 'Terjadi kesalahan pada sistem. Silakan coba lagi.'
            : `${error.code}: ${error.message}`,
        };
    }
  }
}
