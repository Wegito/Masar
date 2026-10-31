import type { BookingChannel, Gender } from '@masar/shared';

import {
  hasGenderConflict,
  isSeatTaken,
  type Occupation,
  saleRestriction,
  type Segment,
} from './seat-rules.js';

/**
 * Prüft eine Sitzauswahl für eine neue Buchung (ADR 0005, 0006, 0007). Der Buchungsservice ruft das
 * unter der Trip-Sperre mit frisch gelesenen Daten auf. Ergebnis ist der erste verletzte Fall mit
 * allen betroffenen Sitzen, damit die Oberfläche sie markieren kann.
 */

export interface RequestedPassenger {
  readonly seatId: string;
  readonly gender: Gender | null;
}

export interface TripSeatState {
  readonly label: string;
  readonly onlineSellable: boolean;
  readonly blocked: boolean;
}

export interface SeatSelectionInput {
  readonly passengers: readonly RequestedPassenger[];
  /** Sitze der Fahrt nach Sitz-ID. */
  readonly tripSeats: ReadonlyMap<string, TripSeatState>;
  /** Bestehende Belegungen anderer Buchungen, mindestens alle, die das Segment berühren. */
  readonly occupations: readonly Occupation[];
  readonly neighborsOf: ReadonlyMap<string, readonly string[]>;
  readonly segment: Segment;
  readonly genderRuleEnabled: boolean;
  readonly channel: BookingChannel;
}

export type SeatSelectionErrorCode =
  | 'SEAT_UNKNOWN'
  | 'GENDER_REQUIRED'
  | 'SEAT_BLOCKED'
  | 'SEAT_NOT_ONLINE'
  | 'SEAT_TAKEN'
  | 'GENDER_RULE_CONFLICT';

export interface SeatSelectionError {
  readonly code: SeatSelectionErrorCode;
  /** Beschriftungen der betroffenen Sitze; bei SEAT_UNKNOWN leer (kein Sitz dieser Fahrt). */
  readonly seats: readonly string[];
}

export function checkSeatSelection(input: SeatSelectionInput): SeatSelectionError | null {
  const { passengers, tripSeats } = input;
  if (passengers.some((p) => !tripSeats.has(p.seatId))) {
    return { code: 'SEAT_UNKNOWN', seats: [] };
  }
  const label = (seatId: string): string => (tripSeats.get(seatId) as TripSeatState).label;

  if (input.genderRuleEnabled) {
    const missing = passengers.filter((p) => p.gender === null);
    if (missing.length > 0) {
      return { code: 'GENDER_REQUIRED', seats: missing.map((p) => label(p.seatId)) };
    }
  }

  const failing = (predicate: (p: RequestedPassenger) => boolean): string[] =>
    passengers.filter(predicate).map((p) => label(p.seatId));

  const restriction = (p: RequestedPassenger) =>
    saleRestriction(tripSeats.get(p.seatId) as TripSeatState, input.channel);
  const blocked = failing((p) => restriction(p) === 'BLOCKED');
  if (blocked.length > 0) {
    return { code: 'SEAT_BLOCKED', seats: blocked };
  }
  const notOnline = failing((p) => restriction(p) === 'NOT_ONLINE');
  if (notOnline.length > 0) {
    return { code: 'SEAT_NOT_ONLINE', seats: notOnline };
  }
  const taken = failing((p) => isSeatTaken(p.seatId, input.segment, input.occupations));
  if (taken.length > 0) {
    return { code: 'SEAT_TAKEN', seats: taken };
  }
  if (input.genderRuleEnabled) {
    // Nur bestehende Belegungen zählen: Fahrgäste derselben neuen Buchung sind untereinander
    // ausgenommen (Familie, Paar), weil sie hier noch keine Belegung haben.
    const conflicts = failing((p) =>
      hasGenderConflict({
        seatId: p.seatId,
        segment: input.segment,
        gender: p.gender as Gender,
        occupations: input.occupations,
        neighborsOf: input.neighborsOf,
      }),
    );
    if (conflicts.length > 0) {
      return { code: 'GENDER_RULE_CONFLICT', seats: conflicts };
    }
  }
  return null;
}
