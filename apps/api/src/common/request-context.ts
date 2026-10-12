import type { Request } from 'express';

/** Was aus einer Anfrage in Audit-Log und Sitzungen landet. Keine Personendaten. */
export interface RequestContext {
  requestId?: string;
  ip?: string;
  userAgent?: string;
}

export function requestContext(req: Request): RequestContext {
  const id = (req as { id?: unknown }).id;
  return {
    ...(typeof id === 'string' ? { requestId: id } : {}),
    ...(req.ip !== undefined ? { ip: req.ip } : {}),
    ...(req.get('user-agent') !== undefined
      ? { userAgent: req.get('user-agent')?.slice(0, 256) }
      : {}),
  };
}
