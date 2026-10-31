import type { Gender, SeatState } from '@masar/shared';

import {
  hasGenderConflict,
  isSeatTaken,
  type Occupation,
  saleRestriction,
  type Segment,
} from '../../bookings/domain/seat-rules.js';

/**
 * Sitzplan für eine Fahrt, ein Segment und ein gewähltes Geschlecht (ADR 0006, 0007).
 *
 * Je Sitz entsteht genau ein Zustand. Das Geschlecht anderer Fahrgäste erscheint nie in der
 * Ausgabe, nur „nicht für dich“ (`NOT_FOR_YOU`). Reihenfolge der Zustände: gesperrt, nicht online,
 * belegt, nicht für dich, frei.
 */

export interface SeatMapSeat {
  readonly seatId: string;
  readonly label: string;
  readonly rowIndex: number;
  readonly colIndex: number;
  readonly side: string;
  readonly onlineSellable: boolean;
  readonly blocked: boolean;
}

export interface SeatMapInput {
  readonly seats: readonly SeatMapSeat[];
  readonly occupations: readonly Occupation[];
  readonly neighborsOf: ReadonlyMap<string, readonly string[]>;
  readonly segment: Segment;
  readonly genderRuleEnabled: boolean;
  /** Pflicht bei aktiver Regel; der Aufrufer prüft das vorher (GENDER_REQUIRED). */
  readonly gender: Gender | null;
}

export interface SeatMapEntry {
  readonly seatId: string;
  readonly label: string;
  readonly rowIndex: number;
  readonly colIndex: number;
  readonly side: string;
  readonly state: SeatState;
}

export function computeSeatMap(input: SeatMapInput): SeatMapEntry[] {
  if (input.genderRuleEnabled && input.gender === null) {
    throw new TypeError('Bei aktiver Geschlechtsregel ist das Geschlecht Pflicht');
  }
  return input.seats
    .map((seat): SeatMapEntry => {
      const restriction = saleRestriction(seat, 'ONLINE');
      let state: SeatState;
      if (restriction !== null) {
        state = restriction;
      } else if (isSeatTaken(seat.seatId, input.segment, input.occupations)) {
        state = 'TAKEN';
      } else if (
        input.genderRuleEnabled &&
        input.gender !== null &&
        hasGenderConflict({
          seatId: seat.seatId,
          segment: input.segment,
          gender: input.gender,
          occupations: input.occupations,
          neighborsOf: input.neighborsOf,
        })
      ) {
        state = 'NOT_FOR_YOU';
      } else {
        state = 'FREE';
      }
      return {
        seatId: seat.seatId,
        label: seat.label,
        rowIndex: seat.rowIndex,
        colIndex: seat.colIndex,
        side: seat.side,
        state,
      };
    })
    .sort((a, b) => a.rowIndex - b.rowIndex || a.colIndex - b.colIndex);
}

/** Freie Plätze werden gekappt angezeigt („9+“), damit die Auslastung nicht ablesbar ist. */
export const AVAILABILITY_CAP = 9;

export function cappedAvailability(free: number): { available: number; moreAvailable: boolean } {
  return { available: Math.min(free, AVAILABILITY_CAP), moreAvailable: free > AVAILABILITY_CAP };
}
