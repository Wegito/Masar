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
  'HOLD_EXPIRED',
  'CASH_DEADLINE_PASSED',
  'INVALID_STATE_TRANSITION',
  'BOOKING_NOT_FOUND',
] as const;

export type ProblemMessageKey = (typeof KNOWN_PROBLEM_CODES)[number] | 'generic';

export function problemMessageKey(code: string): ProblemMessageKey {
  return (KNOWN_PROBLEM_CODES as readonly string[]).includes(code)
    ? (code as ProblemMessageKey)
    : 'generic';
}

/** Fehler der API (RFC 9457) oder `NETWORK_ERROR`, wenn die API nicht erreichbar war. */
export interface Problem {
  code: string;
  status: number;
  /** Sitzbeschriftungen aus `params.seats` (z. B. bei `SEAT_TAKEN`); nur unkritische Werte. */
  seats?: string[];
  /** Pfade aus `errors[].path` bei `VALIDATION_FAILED`, etwa `contact.phone`. */
  errorPaths?: string[];
}

/** Liest nur die erwarteten, unkritischen Teile einer Problem-Antwort (ADR 0015). */
export function problemFrom(body: unknown, status: number): Problem {
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const code = typeof record.code === 'string' ? record.code : 'INTERNAL_ERROR';
  const problem: Problem = { code, status };
  const params = record.params;
  if (typeof params === 'object' && params !== null && 'seats' in params) {
    const seats = params.seats;
    if (Array.isArray(seats)) {
      problem.seats = seats.filter(
        (seat): seat is string => typeof seat === 'string' && seat.length <= 16,
      );
    }
  }
  if (Array.isArray(record.errors)) {
    problem.errorPaths = record.errors
      .map((entry: unknown) =>
        typeof entry === 'object' && entry !== null && 'path' in entry ? entry.path : undefined,
      )
      .filter((path): path is string => typeof path === 'string');
  }
  return problem;
}
