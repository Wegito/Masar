import type { Gender } from '@masar/shared';

import { buildNeighborMap, hasGenderConflict } from '../../trips/domain/seat-map.js';
import { type SeqRange, segmentsOverlap } from '../../trips/domain/segment.js';

/**
 * Sitzplan des Schalters (Schritt 2.6, ADR 0030). Reine Funktionen ohne Ein- und Ausgabe.
 *
 * Anders als der Sitzplan der Fahrgäste (`computeSeatStates`) zeigt er dem Personal das ganze
 * Inventar: Kontingent je Sitz (online, Schalter, gesperrt), Belegung für die gewählte Teilstrecke,
 * alle belegten Teilstrecken der Fahrt und je freiem Sitz, für welches Geschlecht er nach der
 * Geschlechtsregel (ADR 0006) wählbar ist. Wer auf einem Sitz sitzt und welches Geschlecht diese
 * Person hat, verlässt die Funktion nie.
 */

export type CounterQuota = 'ONLINE' | 'COUNTER' | 'BLOCKED';
export type CounterSeatState = 'FREE' | 'TAKEN' | 'BLOCKED';

export interface CounterSeatInput {
  id: string;
  isSellable: boolean;
}

export interface CounterTripSeatInput {
  seatId: string;
  onlineSellable: boolean;
  blocked: boolean;
}

export interface CounterOccupationInput extends SeqRange {
  seatId: string;
  /** `null` zählt bei der Geschlechtsregel als Konflikt (sicherer Fehlerfall, ADR 0006). */
  gender: Gender | null;
}

export interface CounterSeatResult {
  quota: CounterQuota;
  state: CounterSeatState;
  /** Belegte Teilstrecken der ganzen Fahrt, zusammengefasst und aufsteigend. */
  occupiedRanges: SeqRange[];
  /**
   * Nur bei freien Sitzen und aktiver Regel: Würde ein Fahrgast dieses Geschlechts neben einer
   * Person anderen Geschlechts aus einer anderen Buchung sitzen? Sonst `null`.
   */
  selectableFor: Record<Gender, boolean> | null;
}

/**
 * Fasst halboffene Teilstrecken zusammen: `[0,2)` und `[2,3)` grenzen aneinander und werden zu
 * `[0,3)`, weil der Sitz dann durchgehend belegt ist. Leere oder verkehrte Strecken fallen weg.
 */
export function mergeRanges(ranges: readonly SeqRange[]): SeqRange[] {
  const sorted = ranges
    .filter((range) => range.fromSeq < range.toSeq)
    .map((range) => ({ fromSeq: range.fromSeq, toSeq: range.toSeq }))
    .sort((a, b) => a.fromSeq - b.fromSeq || a.toSeq - b.toSeq);
  const merged: SeqRange[] = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last !== undefined && range.fromSeq <= last.toSeq) {
      last.toSeq = Math.max(last.toSeq, range.toSeq);
    } else {
      merged.push(range);
    }
  }
  return merged;
}

/** Kanal eines Sitzes; ein Sitz ohne Kontingentzeile oder nicht verkäuflich gilt als gesperrt. */
export function counterQuota(
  seat: CounterSeatInput,
  tripSeat: CounterTripSeatInput | undefined,
): CounterQuota {
  if (tripSeat === undefined || tripSeat.blocked || !seat.isSellable) {
    return 'BLOCKED';
  }
  return tripSeat.onlineSellable ? 'ONLINE' : 'COUNTER';
}

/**
 * Sitzplan des Schalters für eine Teilstrecke. Der Schalter verkauft online- und
 * Schalter-Sitze (ADR 0007); gesperrte nie. `occupations` sind alle Belegungen der Fahrt, nicht
 * nur die überlappenden, damit das Personal sieht, ab welchem Halt ein Sitz frei wird.
 */
export function computeCounterSeatMap(input: {
  seats: readonly CounterSeatInput[];
  tripSeats: readonly CounterTripSeatInput[];
  occupations: readonly CounterOccupationInput[];
  neighbors: readonly { seatId: string; neighborSeatId: string }[];
  segment: SeqRange;
  genderRuleEnabled: boolean;
}): Map<string, CounterSeatResult> {
  const tripSeats = new Map(input.tripSeats.map((tripSeat) => [tripSeat.seatId, tripSeat]));
  const overlapping = input.occupations.filter((occupation) =>
    segmentsOverlap(occupation, input.segment),
  );
  const taken = new Set(overlapping.map((occupation) => occupation.seatId));
  const rangesBySeat = new Map<string, SeqRange[]>();
  for (const occupation of input.occupations) {
    rangesBySeat.set(occupation.seatId, [
      ...(rangesBySeat.get(occupation.seatId) ?? []),
      occupation,
    ]);
  }
  const neighbors = buildNeighborMap(input.genderRuleEnabled ? input.neighbors : []);

  const result = new Map<string, CounterSeatResult>();
  for (const seat of input.seats) {
    const quota = counterQuota(seat, tripSeats.get(seat.id));
    const state: CounterSeatState =
      quota === 'BLOCKED' ? 'BLOCKED' : taken.has(seat.id) ? 'TAKEN' : 'FREE';
    const selectableFor =
      state === 'FREE' && input.genderRuleEnabled
        ? {
            FEMALE: !hasGenderConflict(seat.id, 'FEMALE', input.segment, overlapping, neighbors),
            MALE: !hasGenderConflict(seat.id, 'MALE', input.segment, overlapping, neighbors),
          }
        : null;
    result.set(seat.id, {
      quota,
      state,
      occupiedRanges: mergeRanges(rangesBySeat.get(seat.id) ?? []),
      selectableFor,
    });
  }
  return result;
}
