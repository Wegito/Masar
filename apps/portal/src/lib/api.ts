/** Fehler der API (RFC 9457) oder ein Netzwerkfehler auf dem Gerät. */
export interface Problem {
  code: string;
  status: number;
  params?: Record<string, unknown>;
  errors?: { path: string; rule: string }[];
}

export type ApiResult<T> =
  { ok: true; data: T } | { ok: false; problem: Problem; retryAfterSeconds?: number };

/**
 * Aufruf der API über dieselbe Origin (Rewrite /api). Das Sitzungs-Cookie geht automatisch mit;
 * Bodies sind immer JSON, sonst lehnt der CSRF-Schutz der API ab.
 */
export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method: init.method ?? 'GET',
      credentials: 'same-origin',
      ...(init.body === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(init.body) }),
    });
  } catch {
    return { ok: false, problem: { code: 'NETWORK_ERROR', status: 0 } };
  }
  const body: unknown =
    response.status === 204 ? undefined : await response.json().catch(() => undefined);
  if (response.ok) {
    return { ok: true, data: body as T };
  }
  const problem =
    typeof body === 'object' && body !== null && 'code' in body
      ? (body as Problem)
      : { code: 'INTERNAL_ERROR', status: response.status };
  const retryAfter = Number(response.headers.get('retry-after'));
  return { ok: false, problem, ...(retryAfter > 0 ? { retryAfterSeconds: retryAfter } : {}) };
}

export interface UserSummary {
  id: string;
  email: string | null;
  displayName: string;
  isPlatformAdmin: boolean;
  memberships: {
    companyId: string;
    companySlug: string;
    companyNameAr: string;
    companyNameEn: string;
    role: 'ADMIN' | 'AGENT' | 'DRIVER';
  }[];
}

/** Textwert eines Formularfelds; Dateien oder fehlende Felder ergeben eine leere Zeichenkette. */
export function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}
