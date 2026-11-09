import { AppError } from '../../common/app-error.js';

/**
 * Datenbankfehler aus Prisma 7 mit Treiber-Adapter (`@prisma/adapter-pg`). Rohe Abfragen melden
 * `P2010` mit dem SQLSTATE unter `meta.driverAdapterError.cause.originalCode`; ein abgelaufenes
 * Transaktionsfenster meldet `P2028`. Geprüft gegen PostgreSQL 18 und Prisma 7.10.
 */
interface AdapterCause {
  originalCode?: unknown;
  code?: unknown;
  constraint?: unknown;
}

function adapterCause(error: unknown): AdapterCause | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const meta = (error as { meta?: { driverAdapterError?: { cause?: AdapterCause } } }).meta;
  return meta?.driverAdapterError?.cause;
}

/** SQLSTATE eines Fehlers, auch direkt aus `pg` (fünf Zeichen in `code`). */
export function sqlState(error: unknown): string | undefined {
  const cause = adapterCause(error);
  const value = cause?.originalCode ?? cause?.code;
  if (typeof value === 'string') {
    return value;
  }
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : undefined;
}

/** Name des eindeutigen Index bei `23505`, falls der Adapter ihn liefert. */
export function uniqueIndex(error: unknown): string | undefined {
  const constraint = adapterCause(error)?.constraint;
  if (typeof constraint === 'object' && constraint !== null) {
    const index = (constraint as { index?: unknown }).index;
    return typeof index === 'string' ? index : undefined;
  }
  return undefined;
}

/** Prisma-Codes für ein abgelaufenes Transaktionsfenster oder eine erschöpfte Verbindungswarteschlange. */
const PRISMA_UNAVAILABLE = new Set(['P2024', 'P2028']);

/**
 * SQLSTATEs, die „später erneut versuchen" bedeuten: Sperre nicht rechtzeitig bekommen
 * (`lock_timeout`), Abfrage abgebrochen (`statement_timeout`), Deadlock, Serialisierungskonflikt.
 */
const SQL_UNAVAILABLE = new Set(['55P03', '57014', '40P01', '40001']);

/** Sekunden für `Retry-After`; eine Buchung derselben Fahrt dauert Millisekunden. */
export const RETRY_AFTER_SECONDS = 2;

export function isRetryable(error: unknown): boolean {
  const prismaCode = (error as { code?: unknown } | null)?.code;
  if (typeof prismaCode === 'string' && PRISMA_UNAVAILABLE.has(prismaCode)) {
    return true;
  }
  const state = sqlState(error);
  return state !== undefined && SQL_UNAVAILABLE.has(state);
}

/**
 * Bildet Fehler aus kritischen Transaktionen auf fachliche Codes ab (Domänenmodell, „Kritische
 * Transaktion", Schritt 7). Fachfehler (`AppError`) gehen unverändert durch; Unbekanntes wird
 * weitergeworfen und landet als 500 im Filter.
 */
export function mapCriticalError(error: unknown): unknown {
  if (error instanceof AppError) {
    return error;
  }
  if (isRetryable(error)) {
    return new AppError('SERVICE_UNAVAILABLE', {
      detail: 'The trip is busy. Retry shortly.',
      headers: { 'Retry-After': String(RETRY_AFTER_SECONDS) },
    });
  }
  switch (sqlState(error)) {
    // Ein Schreibpfad ohne Prüfung unter der Sperre (oder ein Fehler darin): Das EXCLUDE-Constraint
    // hält trotzdem, ADR 0005.
    case '23P01':
      return new AppError('SEAT_TAKEN', {
        detail: 'One or more seats are already taken on an overlapping segment.',
      });
    // Zusammengesetzte Fremdschlüssel (ADR 0018): Sitz oder Halt gehört nicht zur Fahrt.
    case '23503':
      return new AppError('SEAT_UNKNOWN', {
        detail: 'A seat or stop does not belong to the trip.',
      });
    case undefined:
    default:
      return error;
  }
}
