import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Response } from 'express';
import { randomToken } from '../utils/crypto.util';
import { runWithRequestContext } from '../context/request-context';
import { AuthenticatedRequest } from '../security/auth.types';

/**
 * Membuka konteks permintaan sedini mungkin sehingga seluruh lapisan —
 * termasuk audit log dan penanganan galat — melihat requestId yang sama.
 *
 * requestId diambil dari header X-Request-Id yang dipasang reverse proxy bila
 * ada, agar log nginx dan log aplikasi dapat disandingkan.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(request: AuthenticatedRequest, response: Response, next: NextFunction): void {
    const headerId = request.header('x-request-id');
    const requestId =
      headerId && /^[A-Za-z0-9._-]{1,64}$/.test(headerId) ? headerId : randomToken(12);

    request.requestId = requestId;
    response.setHeader('X-Request-Id', requestId);

    runWithRequestContext(
      {
        requestId,
        ipAddress: request.ip,
        userAgent: request.header('user-agent') ?? undefined,
      },
      () => next(),
    );
  }
}
