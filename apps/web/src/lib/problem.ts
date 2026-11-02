/**
 * Fehlercodes, für die die Fahrgast-App einen eigenen Text hat (Schlüssel unter `errors.*` in
 * messages/ar.json und en.json). Alles andere zeigt einen allgemeinen Text. Texte entstehen nur in
 * der Oberfläche, die API liefert den stabilen `code` (ADR 0015).
 */
export const KNOWN_PROBLEM_CODES = [
  'NETWORK_ERROR',
  'RATE_LIMITED',
  'SERVICE_UNAVAILABLE',
  'VALIDATION_FAILED',
  'TRIP_NOT_FOUND',
  'TRIP_NOT_BOOKABLE',
  'SALES_CLOSED',
  'INVALID_SEGMENT',
  'NO_FARE_FOR_SEGMENT',
] as const;

export type ProblemMessageKey = (typeof KNOWN_PROBLEM_CODES)[number] | 'generic';

export function problemMessageKey(code: string): ProblemMessageKey {
  return (KNOWN_PROBLEM_CODES as readonly string[]).includes(code)
    ? (code as ProblemMessageKey)
    : 'generic';
}
