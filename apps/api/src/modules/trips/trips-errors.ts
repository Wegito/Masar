import { AppError } from '../../common/app-error.js';
import { isRetryable, RETRY_AFTER_SECONDS, sqlState } from '../bookings/db-errors.js';

/**
 * Bildet Datenbankfehler der Fahrtplanung auf fachliche Codes ab. Fachfehler gehen unverändert
 * durch, Unbekanntes landet als 500 im Filter.
 *
 * - Sperre nicht rechtzeitig, Deadlock, Zeitfenster: `SERVICE_UNAVAILABLE` mit `Retry-After`.
 * - `23503` (Fremdschlüssel): Strecke, Bus oder Sitzplan passen nicht zur Firma oder zueinander
 *   (`trip (bus_id, company_id, seat_layout_id) → bus`, ADR 0018). Die Prüfungen unter der Sperre
 *   fangen das vorher ab; der Fremdschlüssel ist die zweite Linie.
 */
export function mapTripsError(error: unknown): unknown {
  if (error instanceof AppError) {
    return error;
  }
  if (isRetryable(error)) {
    return new AppError('SERVICE_UNAVAILABLE', {
      detail: 'The trip or route is busy. Retry shortly.',
      headers: { 'Retry-After': String(RETRY_AFTER_SECONDS) },
    });
  }
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'P2003' || sqlState(error) === '23503') {
    return new AppError('VALIDATION_FAILED', {
      detail: 'Route, bus and seat layout do not fit together.',
    });
  }
  return error;
}
