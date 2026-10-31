import { Prisma } from '../generated/prisma/client.js';

/**
 * SQLSTATE und Constraint eines Datenbankfehlers. Prisma 7 mit dem pg-Adapter liefert beides in
 * `meta.driverAdapterError.cause` (beobachtet 2026-10-31, für rohes SQL wie für die Modell-API).
 */
interface DriverCause {
  originalCode?: unknown;
  originalMessage?: unknown;
  constraint?: { index?: unknown };
}

function driverCause(error: unknown): DriverCause | undefined {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return undefined;
  }
  const adapterError = error.meta?.driverAdapterError as { cause?: DriverCause } | undefined;
  return adapterError?.cause;
}

export function databaseErrorCode(error: unknown): string | undefined {
  const code = driverCause(error)?.originalCode;
  return typeof code === 'string' ? code : undefined;
}

/** Name des verletzten Constraints, soweit der Treiber ihn nennt. */
export function databaseConstraint(error: unknown): string | undefined {
  const cause = driverCause(error);
  if (typeof cause?.constraint?.index === 'string') {
    return cause.constraint.index;
  }
  const message = typeof cause?.originalMessage === 'string' ? cause.originalMessage : '';
  return /constraint "([^"]+)"/.exec(message)?.[1];
}

/** Prisma meldet ein abgelaufenes Zeitlimit einer interaktiven Transaktion als P2028. */
export function isTransactionTimeout(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2028';
}
