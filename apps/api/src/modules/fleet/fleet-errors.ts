import type { ErrorCode } from '@masar/shared';

import { AppError } from '../../common/app-error.js';
import { isRetryable, RETRY_AFTER_SECONDS, sqlState } from '../bookings/db-errors.js';

/** Eindeutiger Index verletzt: Prisma meldet `P2002`, rohes SQL den SQLSTATE `23505`. */
export function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'P2002' || sqlState(error) === '23505';
}

/**
 * Bildet Datenbankfehler der Flotte auf fachliche Codes ab. Ein Fremdschlüssel, der eine Änderung
 * verhindert (`23503`, z. B. ein Kontingent auf einem Sitz), heißt: Eine Fahrt nutzt den Plan oder
 * Bus. Fachfehler gehen unverändert durch, Unbekanntes landet als 500 im Filter.
 */
export function mapFleetError(error: unknown, inUse: ErrorCode = 'SEAT_LAYOUT_IN_USE'): unknown {
  if (error instanceof AppError) {
    return error;
  }
  if (isRetryable(error)) {
    return new AppError('SERVICE_UNAVAILABLE', {
      detail: 'The fleet record is busy. Retry shortly.',
      headers: { 'Retry-After': String(RETRY_AFTER_SECONDS) },
    });
  }
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'P2003' || sqlState(error) === '23503') {
    return new AppError(inUse);
  }
  return error;
}
