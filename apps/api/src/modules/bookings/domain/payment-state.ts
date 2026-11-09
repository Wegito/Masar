import type { BookingStatus, PaymentState, PaymentStatus } from '@masar/shared';

/**
 * Status und Zahlungsstand einer Buchung für das Portal (Schritt 2.5, ADR 0028). Reine Funktionen
 * ohne Ein- und Ausgabe.
 */

/**
 * Status, wie das Personal ihn sehen muss: Ein Hold oder eine Reservierung nach Ablauf der Frist
 * ist `EXPIRED`, auch wenn der Ablauf-Job sie noch nicht freigegeben hat (dieselbe Regel wie
 * `isPastDeadline` und `expiredCondition` im Repository; Fristende zählt als abgelaufen).
 */
export function effectiveBookingStatus(
  booking: { status: BookingStatus; holdExpiresAt: Date | null; deadlineAt: Date | null },
  now: Date,
): BookingStatus {
  const passed = (at: Date | null): boolean => at !== null && at.getTime() <= now.getTime();
  if (booking.status === 'HELD' && passed(booking.holdExpiresAt)) {
    return 'EXPIRED';
  }
  if (
    (booking.status === 'RESERVED' || booking.status === 'PENDING_CONFIRMATION') &&
    passed(booking.deadlineAt)
  ) {
    return 'EXPIRED';
  }
  return booking.status;
}

/**
 * Zahlungsstand aus Buchung und `payment`-Zeilen. Bis Phase 3 gibt es keine `payment`-Zeilen: Eine
 * Barzahlung bestätigt das Personal direkt an der Buchung (`confirmed_at`), deshalb folgt der Stand
 * dann allein aus Status und Zahlweg. Sobald Zahlungen entstehen, zählt eine erfolgreiche Zahlung
 * als bezahlt und eine zu prüfende als `IN_REVIEW`, auch wenn die Buchung sich noch nicht bewegt
 * hat.
 *
 * Eine stornierte Buchung, die vorher bestätigt war, bleibt `PAID`: Erstattungen gibt es erst mit
 * Phase 3, und das Personal muss sehen, dass Geld geflossen ist.
 */
export function paymentStateOf(input: {
  status: BookingStatus;
  confirmedAt: Date | null;
  payments: readonly PaymentStatus[];
}): PaymentState {
  const paid =
    input.status === 'CONFIRMED' ||
    input.confirmedAt !== null ||
    input.payments.includes('SUCCEEDED');
  if (paid) {
    return 'PAID';
  }
  if (input.status === 'CANCELLED' || input.status === 'EXPIRED') {
    return 'NONE';
  }
  if (input.status === 'PENDING_CONFIRMATION' || input.payments.includes('AWAITING_REVIEW')) {
    return 'IN_REVIEW';
  }
  if (input.status === 'RESERVED') {
    return 'CASH_DUE';
  }
  return 'UNPAID';
}
