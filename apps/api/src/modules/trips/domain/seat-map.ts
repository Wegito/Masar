import type { Gender, SeatState } from '@masar/shared';

import { type SeqRange, segmentsOverlap } from './segment.js';

/**
 * Sitzstatus für Fahrt, Teilstrecke und gewähltes Geschlecht (ADR 0005, 0006, 0007). Reine
 * Funktionen ohne Ein- und Ausgabe.
 *
 * Vorrang, wenn mehrere Gründe zutreffen:
 *
 * 1. `BLOCKED`: Sitz gesperrt, im Sitzplan nicht verkäuflich oder ohne Kontingentzeile.
 * 2. `NOT_ONLINE`: Sitz verkauft der Schalter. Steht vor `TAKEN`, damit Belegungen aus dem
 *    Schalterkontingent (Phase 2) online nicht sichtbar werden.
 * 3. `TAKEN`: Belegung auf einer überlappenden Teilstrecke.
 * 4. `NOT_FOR_YOU`: Geschlechtsregel aktiv, Geschlecht angegeben, und ein Nachbar ist auf einer
 *    überlappenden Teilstrecke mit anderem oder fehlendem Geschlecht belegt.
 * 5. `FREE`.
 *
 * Das Geschlecht anderer Fahrgäste verlässt diese Funktion nie, nur der Status.
 */

export interface SeatInput {
  id: string;
  isSellable: boolean;
}

export interface TripSeatInput {
  seatId: string;
  onlineSellable: boolean;
  blocked: boolean;
}

export interface OccupationInput extends SeqRange {
  seatId: string;
  /** `null` zählt bei der Geschlechtsregel als Konflikt (sicherer Fehlerfall). */
  gender: Gender | null;
}

export interface NeighborInput {
  seatId: string;
  neighborSeatId: string;
}

export interface SeatStateInput {
  seats: readonly SeatInput[];
  tripSeats: readonly TripSeatInput[];
  occupations: readonly OccupationInput[];
  neighbors: readonly NeighborInput[];
  segment: SeqRange;
  /** Kopie der Firmeneinstellung auf der Fahrt. */
  genderRuleEnabled: boolean;
  /** Für wen gebucht wird; ohne Angabe prüft die Funktion die Regel nicht. */
  gender?: Gender;
}

/** Nachbarn je Sitz, symmetrisch ergänzt: Die Datenbank erzwingt die Symmetrie nicht. */
export function buildNeighborMap(neighbors: readonly NeighborInput[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const add = (a: string, b: string): void => {
    const set = map.get(a) ?? new Set<string>();
    set.add(b);
    map.set(a, set);
  };
  for (const { seatId, neighborSeatId } of neighbors) {
    add(seatId, neighborSeatId);
    add(neighborSeatId, seatId);
  }
  return map;
}

/**
 * Wählt ein Fahrgast dieses Geschlechts den Sitz, säße er auf der Teilstrecke neben einer Person
 * anderen oder unbekannten Geschlechts? Ausnahme „dieselbe Buchung" greift erst beim Reservieren.
 */
export function hasGenderConflict(
  seatId: string,
  gender: Gender,
  segment: SeqRange,
  occupations: readonly OccupationInput[],
  neighbors: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  const adjacent = neighbors.get(seatId);
  if (adjacent === undefined) {
    return false;
  }
  return occupations.some(
    (occupation) =>
      adjacent.has(occupation.seatId) &&
      segmentsOverlap(occupation, segment) &&
      occupation.gender !== gender,
  );
}

export function computeSeatStates(input: SeatStateInput): Map<string, SeatState> {
  const tripSeats = new Map(input.tripSeats.map((tripSeat) => [tripSeat.seatId, tripSeat]));
  const overlapping = input.occupations.filter((occupation) =>
    segmentsOverlap(occupation, input.segment),
  );
  const takenSeatIds = new Set(overlapping.map((occupation) => occupation.seatId));
  const gender = input.genderRuleEnabled ? input.gender : undefined;
  const neighbors = buildNeighborMap(gender === undefined ? [] : input.neighbors);

  const states = new Map<string, SeatState>();
  for (const seat of input.seats) {
    const tripSeat = tripSeats.get(seat.id);
    let state: SeatState;
    if (tripSeat === undefined || tripSeat.blocked || !seat.isSellable) {
      state = 'BLOCKED';
    } else if (!tripSeat.onlineSellable) {
      state = 'NOT_ONLINE';
    } else if (takenSeatIds.has(seat.id)) {
      state = 'TAKEN';
    } else if (
      gender !== undefined &&
      hasGenderConflict(seat.id, gender, input.segment, overlapping, neighbors)
    ) {
      state = 'NOT_FOR_YOU';
    } else {
      state = 'FREE';
    }
    states.set(seat.id, state);
  }
  return states;
}
