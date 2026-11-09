import type { BookingChannel } from '@masar/shared';

/**
 * Wiederholung über den `Idempotency-Key` (API-Konventionen, ADR 0030). Reine Funktion.
 *
 * Eine Wiederholung liefert die vorhandene Buchung nur, wenn sie dieselbe Anfrage war: derselbe
 * Kanal, dieselbe Firma (beim Schalter), dieselbe Fahrt, dieselbe Teilstrecke und dieselben Sitze.
 * Sonst `IDEMPOTENCY_KEY_REUSED`. Der Kanal zählt mit, weil eine Online-Wiederholung ein neues
 * Verwaltungstoken ausgibt: Ein Schlüssel einer Schalterbuchung darf online kein Token öffnen, und
 * eine fremde Firma darf über den Schlüssel keine Buchung einer anderen sehen.
 */
export interface IdempotentBooking {
  companyId: string;
  channel: BookingChannel;
  tripId: string;
  fromTripStopId: string;
  toTripStopId: string;
  seatIds: readonly string[];
}

export interface IdempotentRequest {
  /** Firma aus dem geprüften Pfad; `null` bei der Gastbuchung (jede Firma). */
  companyId: string | null;
  channel: BookingChannel;
  tripId: string;
  fromStopId: string;
  toStopId: string;
  seatIds: readonly string[];
}

function sameSeats(a: readonly string[], b: readonly string[]): boolean {
  const left = [...a].sort();
  const right = [...b].sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function isSameBookingRequest(
  existing: IdempotentBooking,
  request: IdempotentRequest,
): boolean {
  return (
    existing.channel === request.channel &&
    (request.companyId === null || existing.companyId === request.companyId) &&
    existing.tripId === request.tripId &&
    existing.fromTripStopId === request.fromStopId &&
    existing.toTripStopId === request.toStopId &&
    sameSeats(existing.seatIds, request.seatIds)
  );
}
