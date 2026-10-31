import { describe, expect, it } from 'vitest';

import { neighborMap, type Occupation } from './seat-rules.js';
import {
  checkSeatSelection,
  type SeatSelectionInput,
  type TripSeatState,
} from './seat-selection.js';

// Reihe 2+2: s1|s2 links, s3|s4 rechts; s5 nur am Schalter, s6 gesperrt. Segment Homs → Aleppo [1,3).
const TRIP_SEATS = new Map<string, TripSeatState>([
  ['s1', { label: '1', onlineSellable: true, blocked: false }],
  ['s2', { label: '2', onlineSellable: true, blocked: false }],
  ['s3', { label: '3', onlineSellable: true, blocked: false }],
  ['s4', { label: '4', onlineSellable: true, blocked: false }],
  ['s5', { label: '5', onlineSellable: false, blocked: false }],
  ['s6', { label: '6', onlineSellable: false, blocked: true }],
]);
const NEIGHBORS = neighborMap([
  { seatId: 's1', neighborSeatId: 's2' },
  { seatId: 's2', neighborSeatId: 's1' },
  { seatId: 's3', neighborSeatId: 's4' },
  { seatId: 's4', neighborSeatId: 's3' },
]);
const MAN_ON_1: Occupation = {
  seatId: 's1',
  fromSeq: 0,
  toSeq: 2,
  bookingId: 'b-alt',
  gender: 'MALE',
};

function check(overrides: Partial<SeatSelectionInput>) {
  return checkSeatSelection({
    passengers: [{ seatId: 's3', gender: 'FEMALE' }],
    tripSeats: TRIP_SEATS,
    occupations: [MAN_ON_1],
    neighborsOf: NEIGHBORS,
    segment: { fromSeq: 1, toSeq: 3 },
    genderRuleEnabled: true,
    channel: 'ONLINE',
    ...overrides,
  });
}

describe('Sitzauswahl prüfen', () => {
  it('akzeptiert einen freien, passenden Sitz', () => {
    expect(check({})).toBeNull();
  });

  it('lehnt Sitze ab, die nicht zur Fahrt gehören', () => {
    expect(check({ passengers: [{ seatId: 'fremd', gender: 'FEMALE' }] })).toEqual({
      code: 'SEAT_UNKNOWN',
      seats: [],
    });
  });

  it('verlangt bei aktiver Regel ein Geschlecht für jeden Fahrgast', () => {
    expect(
      check({
        passengers: [
          { seatId: 's3', gender: 'FEMALE' },
          { seatId: 's4', gender: null },
        ],
      }),
    ).toEqual({ code: 'GENDER_REQUIRED', seats: ['4'] });
    expect(
      check({ genderRuleEnabled: false, passengers: [{ seatId: 's4', gender: null }] }),
    ).toBeNull();
  });

  it('meldet gesperrte vor nicht online verkäuflichen Sitzen', () => {
    expect(
      check({
        passengers: [
          { seatId: 's5', gender: 'FEMALE' },
          { seatId: 's6', gender: 'FEMALE' },
        ],
      }),
    ).toEqual({ code: 'SEAT_BLOCKED', seats: ['6'] });
    expect(check({ passengers: [{ seatId: 's5', gender: 'FEMALE' }] })).toEqual({
      code: 'SEAT_NOT_ONLINE',
      seats: ['5'],
    });
  });

  it('erlaubt dem Schalter Sitze außerhalb des Online-Kontingents, aber keine gesperrten', () => {
    expect(
      check({ channel: 'COUNTER', passengers: [{ seatId: 's5', gender: 'FEMALE' }] }),
    ).toBeNull();
    expect(check({ channel: 'COUNTER', passengers: [{ seatId: 's6', gender: 'FEMALE' }] })).toEqual(
      {
        code: 'SEAT_BLOCKED',
        seats: ['6'],
      },
    );
  });

  it('meldet belegte Sitze auf überlappender Teilstrecke', () => {
    expect(check({ passengers: [{ seatId: 's1', gender: 'MALE' }] })).toEqual({
      code: 'SEAT_TAKEN',
      seats: ['1'],
    });
    expect(
      check({ segment: { fromSeq: 2, toSeq: 3 }, passengers: [{ seatId: 's1', gender: 'MALE' }] }),
    ).toBeNull();
  });

  it('lehnt eine Frau neben einem fremden Mann ab, mit allen betroffenen Sitzen', () => {
    expect(check({ passengers: [{ seatId: 's2', gender: 'FEMALE' }] })).toEqual({
      code: 'GENDER_RULE_CONFLICT',
      seats: ['2'],
    });
  });

  it('erlaubt Mann und Frau nebeneinander in derselben Buchung', () => {
    expect(
      check({
        occupations: [],
        passengers: [
          { seatId: 's3', gender: 'FEMALE' },
          { seatId: 's4', gender: 'MALE' },
        ],
      }),
    ).toBeNull();
  });
});
