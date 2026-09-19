import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Konteks per permintaan.
 *
 * Dipakai audit log agar setiap entri membawa request_id, alamat IP, dan
 * user agent tanpa harus meneruskan parameter itu melalui setiap lapisan.
 */
export interface RequestContext {
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
  actorId?: string;
  actorRole?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** Melengkapi konteks setelah identitas pemanggil diketahui (setelah guard sesi). */
export function setActor(actorId: string, actorRole: string): void {
  const context = storage.getStore();
  if (context) {
    context.actorId = actorId;
    context.actorRole = actorRole;
  }
}
