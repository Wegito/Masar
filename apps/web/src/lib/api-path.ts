export type QueryValue = string | number | undefined;

/** Pfad unter /api/v1 mit Query; leere Werte entfallen. */
export function apiPath(path: string, query: Record<string, QueryValue> = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') {
      params.set(key, String(value));
    }
  }
  const search = params.toString();
  return `/api/v1${path}${search === '' ? '' : `?${search}`}`;
}
