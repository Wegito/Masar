import type { BookingStatus, CancelActor } from '@masar/shared';

import { bookingTransition } from './transitions.js';

/**
 * Stornoregeln (docs/domaenenmodell.md, „Umsetzung 1.3"). Reine Funktionen.
 *
 * - Unbezahlte Buchungen (`HELD`, `RESERVED`) darf der Fahrgast bis zur Abfahrt immer freigeben,
 *   ohne Gebühr: Ein freigegebener Sitz nützt der Firma mehr als einer, der bis zur Frist blockiert.
 * - Bestätigte Buchungen nur, wenn die Stornoregel der Route es erlaubt (`allow_passenger_cancel`)
 *   und eine Gebührenstufe erreicht ist. Maßgeblich ist die Stufe mit dem größten
 *   `min_minutes_before_departure`, das noch erreicht ist. Ohne Stufen gilt: erlaubt, gebührenfrei.
 * - `PENDING_CONFIRMATION` entscheidet das Personal (Zahlungseingang prüfen, Phase 3).
 * - Die Firma darf jede aktive Buchung stornieren, auch nach der Abfahrt.
 * - Nach einem Check-in ist kein Storno mehr möglich.
 */

export interface CancellationRule {
  minMinutesBeforeDeparture: number;
  feeBps: number;
}

export type CancellationDecision =
  | { kind: 'NOOP' }
  | { kind: 'ALLOWED'; feeBps: number }
  | { kind: 'REJECTED'; code: 'INVALID_STATE_TRANSITION' | 'BOOKING_NOT_CANCELLABLE' };

/** Gebührenstufe für die verbleibende Zeit, oder `null`, wenn keine Stufe erreicht ist. */
export function cancellationFeeBps(
  rules: readonly CancellationRule[],
  minutesBeforeDeparture: number,
): number | null {
  if (rules.length === 0) {
    return 0;
  }
  const reached = rules
    .filter((rule) => rule.minMinutesBeforeDeparture <= minutesBeforeDeparture)
    .sort((a, b) => b.minMinutesBeforeDeparture - a.minMinutesBeforeDeparture);
  return reached[0]?.feeBps ?? null;
}

export function decideCancellation(input: {
  actor: Exclude<CancelActor, 'SYSTEM'>;
  status: BookingStatus;
  now: Date;
  departureAt: Date;
  anyCheckedIn: boolean;
  allowPassengerCancel: boolean;
  rules: readonly CancellationRule[];
}): CancellationDecision {
  const step = bookingTransition(input.status, 'CANCELLED');
  if (step === 'NOOP') {
    return { kind: 'NOOP' };
  }
  if (step === 'REJECT') {
    return { kind: 'REJECTED', code: 'INVALID_STATE_TRANSITION' };
  }
  if (input.anyCheckedIn) {
    return { kind: 'REJECTED', code: 'BOOKING_NOT_CANCELLABLE' };
  }
  if (input.actor === 'COMPANY') {
    return { kind: 'ALLOWED', feeBps: 0 };
  }

  const minutesBeforeDeparture = Math.floor(
    (input.departureAt.getTime() - input.now.getTime()) / 60_000,
  );
  if (input.departureAt.getTime() <= input.now.getTime()) {
    return { kind: 'REJECTED', code: 'BOOKING_NOT_CANCELLABLE' };
  }
  if (input.status === 'HELD' || input.status === 'RESERVED') {
    return { kind: 'ALLOWED', feeBps: 0 };
  }
  if (input.status !== 'CONFIRMED') {
    return { kind: 'REJECTED', code: 'INVALID_STATE_TRANSITION' };
  }
  if (!input.allowPassengerCancel) {
    return { kind: 'REJECTED', code: 'BOOKING_NOT_CANCELLABLE' };
  }
  const feeBps = cancellationFeeBps(input.rules, minutesBeforeDeparture);
  return feeBps === null
    ? { kind: 'REJECTED', code: 'BOOKING_NOT_CANCELLABLE' }
    : { kind: 'ALLOWED', feeBps };
}
