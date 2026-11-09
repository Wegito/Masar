import type { ApiResult } from './api';

/**
 * Was nach `POST /auth/logout` passiert. Nur wenn die API die Sitzung widerrufen hat (ok) oder
 * sie ohnehin nicht mehr gilt (401), geht es zum Login. Bei Netzfehler, 429 oder 5xx bleibt die
 * Sitzung gültig, und das HttpOnly-Cookie lässt sich im Browser nicht löschen: Dann darf die
 * Oberfläche nicht so tun, als sei die Person abgemeldet (geteilte Schalter-Tablets, ADR 0009).
 */
export function logoutOutcome(result: ApiResult<unknown>): 'redirect' | 'error' {
  return result.ok || result.problem.status === 401 ? 'redirect' : 'error';
}
