import type { BookingChannel, BookingStatus } from '@masar/shared';

/**
 * Fristen einer Buchung (docs/domaenenmodell.md, „Umsetzung 1.3"). Reine Funktionen; die Zeit
 * kommt immer als Parameter, nie aus `new Date()`.
 */

const MINUTE = 60_000;

function addMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * MINUTE);
}

function earlier(a: Date, b: Date): Date {
  return a.getTime() <= b.getTime() ? a : b;
}

/**
 * Ende des Holds: `hold_minutes` der Firma ab jetzt, höchstens bis zur Abfahrt. Ein Hold kurz vor
 * dem Verkaufsschluss darf noch zu Ende gebucht werden; über die Abfahrt hinaus hält er nichts.
 */
export function holdExpiresAt(now: Date, holdMinutes: number, departureAt: Date): Date {
  return earlier(addMinutes(now, holdMinutes), departureAt);
}

/**
 * Barfrist der Fahrt: Bis dahin muss bar bezahlt sein, sonst verfällt die Reservierung.
 * Maßgeblich ist `trip.cash_deadline_at`; fehlt sie, gilt `cash_deadline_minutes` der Firma vor
 * der Abfahrt. Die Frist ist absolut je Fahrt, nicht relativ zur Reservierung: Alle Barreservierungen
 * einer Fahrt verfallen zum selben Zeitpunkt, und der Schalter weiß, bis wann er Sitze freihält.
 */
export function cashDeadlineAt(input: {
  tripCashDeadlineAt: Date | null;
  departureAt: Date;
  cashDeadlineMinutes: number;
}): Date {
  return input.tripCashDeadlineAt ?? addMinutes(input.departureAt, -input.cashDeadlineMinutes);
}

/** Verkaufsschluss aus der Firmeneinstellung, für das Anlegen von Fahrten (Portal, Phase 2). */
export function onlineSalesCloseAt(departureAt: Date, onlineSalesCloseMinutes: number): Date {
  return addMinutes(departureAt, -onlineSalesCloseMinutes);
}

/**
 * Ist der Verkauf für diesen Kanal offen? Online endet er mit `online_sales_close_at`; Schalter und
 * Admin (Phase 2) verkaufen bis zur Abfahrt.
 */
export function salesOpen(input: {
  channel: BookingChannel;
  now: Date;
  onlineSalesCloseAt: Date;
  departureAt: Date;
}): boolean {
  const close = input.channel === 'ONLINE' ? input.onlineSalesCloseAt : input.departureAt;
  return input.now.getTime() < close.getTime();
}

/**
 * Ist die Frist einer aktiven, unbestätigten Buchung abgelaufen? `HELD` hängt an
 * `hold_expires_at`, `RESERVED` und `PENDING_CONFIRMATION` an `deadline_at`. Genau dieselbe Regel
 * steht als SQL im Repository (`releaseExpired`); ein Test hält beide gleich.
 */
export function isPastDeadline(
  booking: { status: BookingStatus; holdExpiresAt: Date | null; deadlineAt: Date | null },
  now: Date,
): boolean {
  const limit =
    booking.status === 'HELD'
      ? booking.holdExpiresAt
      : booking.status === 'RESERVED' || booking.status === 'PENDING_CONFIRMATION'
        ? booking.deadlineAt
        : null;
  return limit !== null && limit.getTime() <= now.getTime();
}
