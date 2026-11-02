import { headers } from 'next/headers';

import { apiPath, type QueryValue } from './api-path';

/**
 * Serverseitiger Zugriff auf die API. Nur aus Server Components und Server Actions aufrufen: Der
 * Browser lädt so keine Daten selbst nach, und die Seiten funktionieren ohne viel Client-JS.
 *
 * Basis-URL wie beim Rewrite in next.config.ts. In Produktion erreicht der Web-Server die API
 * direkt im internen Netz, nicht über Caddy.
 */
const API_ORIGIN = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';

/** Schwaches Netz liegt zwischen Browser und Web-Server, nicht hier; die API antwortet schnell. */
const TIMEOUT_MS = 10_000;

/** Fehler der API (RFC 9457) oder `NETWORK_ERROR`, wenn die API nicht erreichbar war. */
export interface Problem {
  code: string;
  status: number;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; problem: Problem };

export interface ApiGetOptions {
  /** Sekunden im Datencache von Next; ohne Angabe wird nie zwischengespeichert. */
  revalidate?: number;
}

/**
 * GET gegen die API. Die Antwort ist entweder Daten oder ein Problem mit stabilem `code`; Texte
 * entstehen erst in der Oberfläche. Die URL wird nie geloggt: Der Sitzplan trägt das gewählte
 * Geschlecht im Query (ADR 0019).
 *
 * `X-Forwarded-For` wird unverändert weitergereicht, damit die Ratenbegrenzung der API den
 * Fahrgast sieht und nicht den Web-Server. Wirkt nur, wenn die API dem Web-Server als Proxy
 * vertraut (`TRUST_PROXY`, siehe docs/web-fahrgastablauf.md).
 */
export async function apiGet<T>(
  path: string,
  query: Record<string, QueryValue> = {},
  options: ApiGetOptions = {},
): Promise<ApiResult<T>> {
  const forwardedFor = (await headers()).get('x-forwarded-for');
  let response: Response;
  try {
    response = await fetch(`${API_ORIGIN}${apiPath(path, query)}`, {
      headers: {
        Accept: 'application/json',
        ...(forwardedFor === null ? {} : { 'X-Forwarded-For': forwardedFor }),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      ...(options.revalidate === undefined
        ? { cache: 'no-store' as const }
        : { next: { revalidate: options.revalidate } }),
    });
  } catch {
    return { ok: false, problem: { code: 'NETWORK_ERROR', status: 0 } };
  }
  const body: unknown = await response.json().catch(() => undefined);
  if (response.ok && body !== undefined) {
    return { ok: true, data: body as T };
  }
  const code =
    typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string'
      ? body.code
      : 'INTERNAL_ERROR';
  return { ok: false, problem: { code, status: response.status } };
}
