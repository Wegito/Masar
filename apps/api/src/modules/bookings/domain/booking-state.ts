import type { BookingStatus, CancelActor } from '@masar/shared';

/**
 * Zustandsautomat der Buchung (docs/domaenenmodell.md). Rein und ohne Datenbank.
 *
 * Jeder Übergang nach EXPIRED oder CANCELLED löscht die Belegung in derselben Transaktion; das
 * erledigt der Buchungsservice. Eine Wiederholung desselben Übergangs ist ein No-op, kein Fehler.
 */
export const BOOKING_TRANSITIONS: Readonly<Record<BookingStatus, readonly BookingStatus[]>> = {
  HELD: ['RESERVED', 'PENDING_CONFIRMATION', 'CONFIRMED', 'EXPIRED', 'CANCELLED'],
  RESERVED: ['CONFIRMED', 'EXPIRED', 'CANCELLED'],
  PENDING_CONFIRMATION: ['CONFIRMED', 'CANCELLED', 'EXPIRED'],
  CONFIRMED: ['CANCELLED'],
  CANCELLED: [],
  EXPIRED: [],
};

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return BOOKING_TRANSITIONS[from].includes(to);
}

/**
 * Wer welche Buchung stornieren darf (Entscheidung vom 2026-10-31 für Phase 1): Fahrgäste nur,
 * solange kein Geld geflossen ist (HELD, RESERVED). Bestätigte Buchungen storniert nur die Firma;
 * Stornogebühren und Erstattungen folgen mit den Zahlungen in Phase 3.
 */
const CANCELLABLE_BY: Readonly<Record<CancelActor, readonly BookingStatus[]>> = {
  PASSENGER: ['HELD', 'RESERVED'],
  COMPANY: ['HELD', 'RESERVED', 'PENDING_CONFIRMATION', 'CONFIRMED'],
  SYSTEM: ['HELD', 'RESERVED', 'PENDING_CONFIRMATION', 'CONFIRMED'],
};

export function canCancel(status: BookingStatus, actor: CancelActor): boolean {
  return CANCELLABLE_BY[actor].includes(status);
}

export interface DueCheck {
  readonly status: BookingStatus;
  readonly holdExpiresAt: Date | null;
  readonly deadlineAt: Date | null;
}

/** Ist die Buchung abgelaufen? Hold nach seiner Frist, Barreservierung nach der Barfrist. */
export function isDue(booking: DueCheck, now: Date): boolean {
  if (booking.status === 'HELD') {
    return booking.holdExpiresAt !== null && booking.holdExpiresAt <= now;
  }
  if (booking.status === 'RESERVED') {
    return booking.deadlineAt !== null && booking.deadlineAt <= now;
  }
  return false;
}

export interface TripDeadlines {
  readonly onlineSalesCloseAt: Date;
  readonly cashDeadlineAt: Date;
}

/**
 * Ende der Online-Buchung einer Fahrt. Solange bar der einzige Zahlweg ist (Phase 1), schließt sie
 * bei der früheren der beiden Fristen: Ein Hold nach der Barfrist ließe sich nicht mehr bezahlen.
 */
export function onlineBookingCutoff(trip: TripDeadlines): Date {
  return trip.cashDeadlineAt < trip.onlineSalesCloseAt
    ? trip.cashDeadlineAt
    : trip.onlineSalesCloseAt;
}

/** Ablauf eines neuen Holds: nach den Minuten der Firma, spätestens zur Barfrist. */
export function holdExpiry(now: Date, holdMinutes: number, trip: TripDeadlines): Date {
  const expiry = new Date(now.getTime() + holdMinutes * 60_000);
  return expiry < trip.cashDeadlineAt ? expiry : trip.cashDeadlineAt;
}
