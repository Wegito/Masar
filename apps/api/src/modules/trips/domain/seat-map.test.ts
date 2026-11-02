import { describe, expect, it } from 'vitest';

import { generateSeatLayout } from '../../fleet/domain/seat-layout-generator.js';
import {
  computeSeatStates,
  type NeighborInput,
  type OccupationInput,
  type SeatStateInput,
} from './seat-map.js';

/** 45-Sitzer aus dem Generator; die Sitz-ID ist hier die Beschriftung. */
const layout = generateSeatLayout({ pattern: '2+2', rows: 10, backBench: 5 });
const SEATS = layout.seats.map((seat) => ({ id: seat.label, isSellable: seat.isSellable }));
/** Wie in der Datenbank: jedes Paar in beiden Richtungen. */
const NEIGHBORS: NeighborInput[] = layout.neighbors.flatMap(([a, b]) => [
  { seatId: a, neighborSeatId: b },
  { seatId: b, neighborSeatId: a },
]);
const ALL_ONLINE = SEATS.map((seat) => ({ seatId: seat.id, onlineSellable: true, blocked: false }));

function input(overrides: Partial<SeatStateInput>): SeatStateInput {
  return {
    seats: SEATS,
    tripSeats: ALL_ONLINE,
    occupations: [],
    neighbors: NEIGHBORS,
    segment: { fromSeq: 0, toSeq: 3 },
    genderRuleEnabled: true,
    ...overrides,
  };
}

function occupied(
  seatId: string,
  fromSeq: number,
  toSeq: number,
  gender: OccupationInput['gender'],
) {
  return { seatId, fromSeq, toSeq, gender };
}

describe('computeSeatStates', () => {
  it('meldet ohne Belegung jeden Sitz als FREE', () => {
    const states = computeSeatStates(input({ gender: 'FEMALE' }));
    expect(states.size).toBe(45);
    expect(new Set(states.values())).toEqual(new Set(['FREE']));
  });

  describe('Teilstrecken', () => {
    const occupations = [occupied('1A', 0, 2, 'FEMALE')];

    it('gibt einen Sitz am Ausstiegshalt des Vorgängers wieder frei ([0,2) belegt, [2,4) frei)', () => {
      const states = computeSeatStates(input({ occupations, segment: { fromSeq: 2, toSeq: 4 } }));
      expect(states.get('1A')).toBe('FREE');
    });

    it('meldet TAKEN bei Überlappung ([0,2) belegt, [1,3) gesucht)', () => {
      const states = computeSeatStates(input({ occupations, segment: { fromSeq: 1, toSeq: 3 } }));
      expect(states.get('1A')).toBe('TAKEN');
    });
  });

  describe('Kontingent', () => {
    it('meldet Schaltersitze als NOT_ONLINE und gesperrte als BLOCKED', () => {
      const tripSeats = ALL_ONLINE.map((seat) =>
        seat.seatId === '9B'
          ? { ...seat, onlineSellable: false }
          : seat.seatId === '9A'
            ? { ...seat, onlineSellable: false, blocked: true }
            : seat,
      );
      const states = computeSeatStates(input({ tripSeats }));
      expect(states.get('9A')).toBe('BLOCKED');
      expect(states.get('9B')).toBe('NOT_ONLINE');
    });

    it('meldet nicht verkäufliche Sitze und Sitze ohne Kontingentzeile als BLOCKED', () => {
      const seats = SEATS.map((seat) => (seat.id === '2A' ? { ...seat, isSellable: false } : seat));
      const tripSeats = ALL_ONLINE.filter((seat) => seat.seatId !== '3A');
      const states = computeSeatStates(input({ seats, tripSeats }));
      expect(states.get('2A')).toBe('BLOCKED');
      expect(states.get('3A')).toBe('BLOCKED');
    });

    it('verrät belegte Schaltersitze nicht (NOT_ONLINE vor TAKEN)', () => {
      const tripSeats = ALL_ONLINE.map((seat) =>
        seat.seatId === '9B' ? { ...seat, onlineSellable: false } : seat,
      );
      const states = computeSeatStates(
        input({ tripSeats, occupations: [occupied('9B', 0, 3, 'MALE')] }),
      );
      expect(states.get('9B')).toBe('NOT_ONLINE');
    });
  });

  describe('Geschlechtsregel', () => {
    const maleIn1A = [occupied('1A', 0, 3, 'MALE')];

    it('sperrt den Nachbarn eines Mannes für eine Frau, nicht für einen Mann', () => {
      const female = computeSeatStates(input({ occupations: maleIn1A, gender: 'FEMALE' }));
      const male = computeSeatStates(input({ occupations: maleIn1A, gender: 'MALE' }));
      expect(female.get('1B')).toBe('NOT_FOR_YOU');
      expect(male.get('1B')).toBe('FREE');
      // Über den Gang (1C) und in der Reihe dahinter (2A) gilt die Regel nicht.
      expect(female.get('1C')).toBe('FREE');
      expect(female.get('2A')).toBe('FREE');
    });

    it('greift nur bei überlappender Teilstrecke', () => {
      const states = computeSeatStates(
        input({
          occupations: [occupied('1A', 0, 1, 'MALE')],
          segment: { fromSeq: 1, toSeq: 3 },
          gender: 'FEMALE',
        }),
      );
      expect(states.get('1B')).toBe('FREE');
    });

    it('wertet eine Belegung ohne Geschlecht als Konflikt für beide', () => {
      const occupations = [occupied('1A', 0, 3, null)];
      expect(computeSeatStates(input({ occupations, gender: 'FEMALE' })).get('1B')).toBe(
        'NOT_FOR_YOU',
      );
      expect(computeSeatStates(input({ occupations, gender: 'MALE' })).get('1B')).toBe(
        'NOT_FOR_YOU',
      );
    });

    it('prüft nichts, wenn die Fahrt die Regel nicht aktiviert hat', () => {
      const states = computeSeatStates(
        input({ occupations: maleIn1A, gender: 'FEMALE', genderRuleEnabled: false }),
      );
      expect(states.get('1B')).toBe('FREE');
    });

    it('prüft nichts ohne Angabe des Geschlechts', () => {
      expect(computeSeatStates(input({ occupations: maleIn1A })).get('1B')).toBe('FREE');
    });

    it('gibt dem mittleren Sitz der Hinterbank zwei Nachbarn', () => {
      const occupations = [occupied('11B', 0, 3, 'MALE'), occupied('11D', 0, 3, 'FEMALE')];
      const female = computeSeatStates(input({ occupations, gender: 'FEMALE' }));
      const male = computeSeatStates(input({ occupations, gender: 'MALE' }));
      expect(female.get('11C')).toBe('NOT_FOR_YOU');
      expect(male.get('11C')).toBe('NOT_FOR_YOU');
      expect(female.get('11E')).toBe('FREE');
      expect(male.get('11A')).toBe('FREE');
    });

    it('ergänzt Nachbarpaare, die nur in einer Richtung gespeichert sind', () => {
      const states = computeSeatStates(
        input({
          occupations: maleIn1A,
          gender: 'FEMALE',
          neighbors: [{ seatId: '1B', neighborSeatId: '1A' }],
        }),
      );
      expect(states.get('1B')).toBe('NOT_FOR_YOU');
    });

    it('lässt den VIP-Einzelsitz ohne Nachbarn immer frei', () => {
      const vip = generateSeatLayout({ pattern: '2+1', rows: 2 });
      const states = computeSeatStates({
        seats: vip.seats.map((seat) => ({ id: seat.label, isSellable: true })),
        tripSeats: vip.seats.map((seat) => ({
          seatId: seat.label,
          onlineSellable: true,
          blocked: false,
        })),
        occupations: [occupied('1A', 0, 1, 'MALE'), occupied('1B', 0, 1, 'MALE')],
        neighbors: vip.neighbors.map(([a, b]) => ({ seatId: a, neighborSeatId: b })),
        segment: { fromSeq: 0, toSeq: 1 },
        genderRuleEnabled: true,
        gender: 'FEMALE',
      });
      expect(states.get('1C')).toBe('FREE');
    });
  });
});
