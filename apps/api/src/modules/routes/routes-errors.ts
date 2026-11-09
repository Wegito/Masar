import { AppError } from '../../common/app-error.js';
import { isRetryable, RETRY_AFTER_SECONDS, sqlState } from '../bookings/db-errors.js';
import type { FareMatrixIssue } from './domain/fare-matrix.js';

/**
 * Bildet Datenbankfehler der Strecken auf fachliche Codes ab. Fachfehler gehen unverändert durch,
 * Unbekanntes landet als 500 im Filter.
 *
 * - `23503` (Fremdschlüssel): Ein Halt, den eine Fahrt kopiert hat (`trip_stop → route_stop
 *   ON DELETE RESTRICT`), oder eine Fahrt auf der Strecke. Die Prüfung unter der Sperre fängt das
 *   vorher ab; der Fremdschlüssel ist die zweite Linie.
 * - `23P01` (`fare_no_overlap`): zwei Tarife für dieselbe Teilstrecke am selben Fahrtag. Kann nur
 *   ein Schreibpfad an der Sperre vorbei auslösen; dann ist die Strecke belegt, später erneut.
 */
export function mapRoutesError(error: unknown): unknown {
  if (error instanceof AppError) {
    return error;
  }
  const state = sqlState(error);
  if (isRetryable(error) || state === '23P01') {
    return new AppError('SERVICE_UNAVAILABLE', {
      detail: 'The route is busy. Retry shortly.',
      headers: { 'Retry-After': String(RETRY_AFTER_SECONDS) },
    });
  }
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'P2003' || state === '23503') {
    return new AppError('ROUTE_IN_USE');
  }
  return error;
}

/** Fachfehler zur Tarifmatrix, mit den betroffenen Paaren als `params` für die Oberfläche. */
export function fareMatrixError(issue: FareMatrixIssue): AppError {
  switch (issue.code) {
    case 'FARE_MATRIX_INVALID':
      return new AppError(issue.code, {
        detail: 'Fare pairs must run forward along the route, once each, with a positive amount.',
        params: { pairs: issue.pairs },
      });
    case 'FARE_MATRIX_INCOMPLETE':
      return new AppError(issue.code, {
        detail: 'Every pair of stops in travel direction needs a fare.',
        params: { missing: issue.missing },
      });
    case 'FARE_NOT_MONOTONIC':
      return new AppError(issue.code, {
        detail: 'A fare must not be lower than the fare of a segment it contains.',
        params: { pair: issue.pair, contained: issue.contained },
      });
  }
}
