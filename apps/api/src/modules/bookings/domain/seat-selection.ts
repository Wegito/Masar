import type { BookingChannel, Gender } from '@masar/shared';

import { buildNeighborMap, hasGenderConflict } from '../../trips/domain/seat-map.js';
import { type SeqRange, segmentsOverlap } from '../../trips/domain/segment.js';

/**
 * Prüfung der gewählten Sitze unter der Trip-Sperre (ADR 0005, 0006, 0007). Reine Funktionen; der
 * Buchungsservice liest die Eingaben frisch nach dem Sperren.
 */

/** Höchstzahl Fahrgäste je Buchung, gleich der Kappung in der Suche („9+"). */
export const MAX_SEATS_PER_BOOKING = 9;

export interface SelectedSeat {
  id: string;
  /** Gehört der Sitz zum Sitzplan der Fahrt? */
  isSellable: boolean;
}

export interface TripSeatQuota {
  seatId: string;
  onlineSellable: boolean;
  blocked: boolean;
}

export interface ExistingOccupation extends SeqRange {
  seatId: string;
  bookingId: string;
  /** `null` zählt bei der Geschlechtsregel als Konflikt (sicherer Fehlerfall, ADR 0006). */
  gender: Gender | null;
}

export type SeatCheck =
  | { ok: true }
  | {
      ok: false;
      code: 'SEAT_UNKNOWN' | 'SEAT_BLOCKED' | 'SEAT_NOT_ONLINE' | 'SEAT_TAKEN';
      seatIds: string[];
    };

/**
 * Kontingent und Belegung in fester Reihenfolge: unbekannt, gesperrt, nicht online, belegt. Je
 * Stufe nennt das Ergebnis alle betroffenen Sitze, damit die Oberfläche sie markieren kann.
 *
 * - Ein Sitz ohne Kontingentzeile oder mit `is_sellable = false` gilt als gesperrt (wie im
 *   Sitzplan, Umsetzung 1.2).
 * - `ONLINE` verlangt `online_sellable`; `COUNTER` und `ADMIN` ignorieren es (ADR 0007).
 */
export function checkSeatSelection(input: {
  channel: BookingChannel;
  requestedSeatIds: readonly string[];
  /** Sitze des Sitzplans der Fahrt, die angefragt wurden. */
  layoutSeats: readonly SelectedSeat[];
  tripSeats: readonly TripSeatQuota[];
  /** Belegungen der angefragten Sitze; die Funktion filtert selbst nach Überlappung. */
  occupations: readonly ExistingOccupation[];
  segment: SeqRange;
}): SeatCheck {
  const layout = new Map(input.layoutSeats.map((seat) => [seat.id, seat]));
  const quota = new Map(input.tripSeats.map((tripSeat) => [tripSeat.seatId, tripSeat]));

  const unknown = input.requestedSeatIds.filter((id) => !layout.has(id));
  if (unknown.length > 0) {
    return { ok: false, code: 'SEAT_UNKNOWN', seatIds: unknown };
  }
  const blocked = input.requestedSeatIds.filter((id) => {
    const tripSeat = quota.get(id);
    return tripSeat === undefined || tripSeat.blocked || layout.get(id)?.isSellable !== true;
  });
  if (blocked.length > 0) {
    return { ok: false, code: 'SEAT_BLOCKED', seatIds: blocked };
  }
  if (input.channel === 'ONLINE') {
    const notOnline = input.requestedSeatIds.filter((id) => quota.get(id)?.onlineSellable !== true);
    if (notOnline.length > 0) {
      return { ok: false, code: 'SEAT_NOT_ONLINE', seatIds: notOnline };
    }
  }
  const requested = new Set(input.requestedSeatIds);
  const taken = [
    ...new Set(
      input.occupations
        .filter(
          (occupation) =>
            requested.has(occupation.seatId) && segmentsOverlap(occupation, input.segment),
        )
        .map((occupation) => occupation.seatId),
    ),
  ];
  if (taken.length > 0) {
    return { ok: false, code: 'SEAT_TAKEN', seatIds: taken };
  }
  return { ok: true };
}

export type GenderCheck =
  | { ok: true }
  | { ok: false; code: 'GENDER_REQUIRED' }
  | { ok: false; code: 'GENDER_RULE_CONFLICT'; seatIds: string[] };

/**
 * Geschlechtsregel für alle Fahrgäste einer Buchung (ADR 0006).
 *
 * - Nur, wenn die Fahrt die Regel aktiviert hat. Dann ist das Geschlecht je Fahrgast Pflicht.
 * - Konflikt: Ein Nachbarsitz ist auf einer überlappenden Teilstrecke von einer anderen Buchung
 *   belegt, und das Geschlecht unterscheidet sich oder fehlt.
 * - Fahrgäste derselben Buchung sind ausgenommen, untereinander und gegenüber Belegungen mit
 *   derselben `bookingId`.
 */
export function checkGenderRule(input: {
  enabled: boolean;
  bookingId?: string;
  passengers: readonly { seatId: string; gender: Gender | null }[];
  occupations: readonly ExistingOccupation[];
  neighbors: readonly { seatId: string; neighborSeatId: string }[];
  segment: SeqRange;
}): GenderCheck {
  if (!input.enabled) {
    return { ok: true };
  }
  if (input.passengers.some((passenger) => passenger.gender === null)) {
    return { ok: false, code: 'GENDER_REQUIRED' };
  }
  const others = input.occupations.filter(
    (occupation) => input.bookingId === undefined || occupation.bookingId !== input.bookingId,
  );
  const neighbors = buildNeighborMap(input.neighbors);
  const conflicts = input.passengers
    .filter((passenger) =>
      hasGenderConflict(passenger.seatId, passenger.gender!, input.segment, others, neighbors),
    )
    .map((passenger) => passenger.seatId);
  return conflicts.length > 0
    ? { ok: false, code: 'GENDER_RULE_CONFLICT', seatIds: conflicts }
    : { ok: true };
}
