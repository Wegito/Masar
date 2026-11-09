/**
 * Wiederholungen der Outbox (ADR 0021). Reine Funktionen.
 *
 * Zustellung ist „mindestens einmal": Ein Absturz zwischen Versand und Quittung führt zu einem
 * zweiten Versand. Das ist für Benachrichtigungen hinnehmbar; doppelte Wirkung bei Zahlungen
 * verhindert dort die eigene Idempotenz (Phase 3).
 */

/** Nach so vielen Versuchen gilt ein Eintrag als `FAILED` und braucht einen Menschen. */
export const OUTBOX_MAX_ATTEMPTS = 8;

const BASE_DELAY_MS = 30_000;
const MAX_DELAY_MS = 60 * 60_000;

/** Sperrfrist eines abgeholten Eintrags: So lange gilt er als in Arbeit und wird nicht erneut abgeholt. */
export const OUTBOX_LEASE_MS = 5 * 60_000;

/** Wartezeit nach dem n-ten fehlgeschlagenen Versuch: 30 s, verdoppelt, höchstens 1 Stunde. */
export function retryDelayMs(attempts: number): number {
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new RangeError('attempts beginnt bei 1');
  }
  return Math.min(BASE_DELAY_MS * 2 ** (attempts - 1), MAX_DELAY_MS);
}

export type FailureOutcome =
  { status: 'PENDING'; nextAttemptAt: Date } | { status: 'FAILED'; nextAttemptAt: Date };

export function afterFailure(attempts: number, now: Date): FailureOutcome {
  if (attempts >= OUTBOX_MAX_ATTEMPTS) {
    return { status: 'FAILED', nextAttemptAt: now };
  }
  return { status: 'PENDING', nextAttemptAt: new Date(now.getTime() + retryDelayMs(attempts)) };
}
