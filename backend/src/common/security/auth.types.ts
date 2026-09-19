import { Request } from 'express';

export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  roleId: string;
  roleCode: string;
  /** Role internal (admin/reviewer/finance) — menentukan kebijakan sesi & MFA. */
  isStaff: boolean;
  permissions: string[];
  sessionId: string;
  /** Waktu OTP terakhir diverifikasi pada sesi ini — dasar step-up MFA. */
  mfaVerifiedAt: Date | null;
  mustChangePassword: boolean;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
  /** Token CSRF milik sesi, dibaca CsrfGuard. */
  sessionCsrfToken?: string;
  requestId?: string;
}

export function hasPermission(user: AuthenticatedUser, permission: string): boolean {
  return user.permissions.includes(permission);
}
