import { forwardedClientIp } from '@masar/shared';
import { headers } from 'next/headers';

import { apiPath, type QueryValue } from './api-path';
import { type Problem, problemFrom } from './problem';

export type { Problem } from './problem';

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
 * Die Client-IP geht als einzelner, geprüfter Eintrag in `X-Forwarded-For` an die API (letzter
 * Eintrag des von Caddy gesetzten Headers, `forwardedClientIp`), nie der rohe Header. So sieht die
 * Ratenbegrenzung der API den Fahrgast und nicht den Web-Server. Wirkt nur mit `TRUST_PROXY=1` in
 * der API und einem Web-Server, der nur über Caddy erreichbar ist (ADR 0033).
 *
 * Ausnahme: Mit `revalidate` geht keine Client-IP mit. Next bildet den Schlüssel des Datencaches
 * aus allen Request-Headern; mit der IP entstünde je Fahrgast ein eigener Eintrag und kein
 * gemeinsamer Cache. Zwischengespeichert werden nur öffentliche Kataloglisten wie die Städte, die
 * kein Limit je Fahrgast brauchen.
 */
export async function apiGet<T>(
  path: string,
  query: Record<string, QueryValue> = {},
  options: ApiGetOptions = {},
): Promise<ApiResult<T>> {
  return request<T>(`${API_ORIGIN}${apiPath(path, query)}`, {
    ...(options.revalidate === undefined
      ? { cache: 'no-store' as const }
      : { next: { revalidate: options.revalidate }, forwardClientIp: false }),
  });
}

export interface ApiSendOptions {
  method: 'GET' | 'POST';
  /** Zusätzliche Header, etwa `X-Manage-Token` (ADR 0020, 0022). Werden nie geloggt. */
  headers?: Record<string, string>;
  /** JSON-Body; Code und Telefon stehen nur hier, nie in der URL (ADR 0016). */
  body?: unknown;
}

/**
 * Aufruf mit Header oder JSON-Body, ohne Datencache. Für Gastzugriffe der Ticketseite (Schritt
 * 1.4): Das Token geht im Header an die API, Code und Telefon im Body.
 */
export async function apiSend<T>(path: string, options: ApiSendOptions): Promise<ApiResult<T>> {
  return request<T>(`${API_ORIGIN}${apiPath(path)}`, {
    method: options.method,
    cache: 'no-store',
    extraHeaders: {
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

async function request<T>(
  url: string,
  init: RequestInit & { extraHeaders?: Record<string, string>; forwardClientIp?: boolean } = {},
): Promise<ApiResult<T>> {
  const { extraHeaders, forwardClientIp = true, ...rest } = init;
  const forwardedFor = forwardClientIp
    ? forwardedClientIp((await headers()).get('x-forwarded-for'))
    : null;
  let response: Response;
  try {
    response = await fetch(url, {
      ...rest,
      headers: {
        Accept: 'application/json',
        ...(forwardedFor === null ? {} : { 'X-Forwarded-For': forwardedFor }),
        ...extraHeaders,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, problem: { code: 'NETWORK_ERROR', status: 0 } };
  }
  const body: unknown = await response.json().catch(() => undefined);
  if (response.ok && body !== undefined) {
    return { ok: true, data: body as T };
  }
  return { ok: false, problem: problemFrom(body, response.status) };
}
