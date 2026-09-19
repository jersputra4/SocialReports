import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit-actions';
import { AuthenticatedRequest } from './auth.types';
import { PERMISSIONS_KEY } from './decorators';

/**
 * RBAC berbasis izin, bukan berbasis nama role (BRD 5.2).
 * Role hanyalah kumpulan izin, sehingga penambahan role baru tidak menuntut
 * perubahan kode.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    if (!user) throw new ForbiddenException('Akses ditolak.');

    const missing = required.filter((permission) => !user.permissions.includes(permission));
    if (missing.length > 0) {
      await this.audit.record({
        action: AuditAction.ACCESS_DENIED,
        entityType: 'endpoint',
        entityId: `${request.method} ${request.path}`,
        after: { requiredPermissions: required, missing },
      });
      throw new ForbiddenException('Anda tidak memiliki izin untuk tindakan ini.');
    }

    return true;
  }
}
