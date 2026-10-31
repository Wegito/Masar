import { describe, expect, it } from 'vitest';

import { neighborMap, type Occupation } from '../../bookings/domain/seat-rules.js';
import { cappedAvailability, computeSeatMap, type SeatMapSeat } from './seat-map.js';

// Eine Reihe 2+2: 1|2 links, 3|4 rechts. Nachbarn 1–2 und 3–4.
function seat(label: string, colIndex: number, overrides: Partial<SeatMapSeat> = {}): SeatMapSeat {
  return {
    seatId: `s${label}`,
    label,
    rowIndex: 0,
    colIndex,
    side: colIndex < 2 ? 'LEFT' : 'RIGHT',
    onlineSellable: true,
    blocked: false,
    ...overrides,
  };
}

const SEATS = [seat('1', 0), seat('2', 1), seat('3', 3), seat('4', 4)];
const NEIGHBORS = neighborMap([
  { seatId: 's1', neighborSeatId: 's2' },
  { seatId: 's2', neighborSeatId: 's1' },
  { seatId: 's3', neighborSeatId: 's4' },
  { seatId: 's4', neighborSeatId: 's3' },
]);

function occupied(
  label: string,
  fromSeq: number,
  toSeq: number,
  gender: 'MALE' | 'FEMALE' | null,
): Occupation {
  return { seatId: `s${label}`, fromSeq, toSeq, bookingId: `b${label}`, gender };
}

function states(input: Partial<Parameters<typeof computeSeatMap>[0]>): Record<string, string> {
  const map = computeSeatMap({
    seats: SEATS,
    occupations: [],
    neighborsOf: NEIGHBORS,
    segment: { fromSeq: 1, toSeq: 3 },
    genderRuleEnabled: true,
    gender: 'FEMALE',
    ...input,
  });
  return Object.fromEntries(map.map((s) => [s.label, s.state]));
}

describe('Sitzplan', () => {
  it('zeigt einen leeren Bus als frei', () => {
    expect(states({})).toEqual({ '1': 'FREE', '2': 'FREE', '3': 'FREE', '4': 'FREE' });
  });

  it('zeigt einen Mann auf überlappender Teilstrecke als belegt und den Nachbarsitz für eine Frau als nicht wählbar', () => {
    expect(states({ occupations: [occupied('1', 0, 2, 'MALE')] })).toEqual({
      '1': 'TAKEN',
      '2': 'NOT_FOR_YOU',
      '3': 'FREE',
      '4': 'FREE',
    });
  });

  it('zeigt denselben Bus für einen Mann ohne Einschränkung neben dem Mann', () => {
    expect(states({ gender: 'MALE', occupations: [occupied('1', 0, 2, 'MALE')] })).toMatchObject({
      '2': 'FREE',
    });
  });

  it('gibt Sitze frei, deren Belegung vor dem gewählten Segment endet', () => {
    expect(states({ occupations: [occupied('1', 0, 1, 'MALE')] })).toMatchObject({
      '1': 'FREE',
      '2': 'FREE',
    });
  });

  it('beachtet die Regel nicht, wenn die Fahrt sie nicht aktiviert hat', () => {
    expect(
      states({
        genderRuleEnabled: false,
        gender: null,
        occupations: [occupied('1', 0, 2, 'MALE')],
      }),
    ).toMatchObject({ '2': 'FREE' });
  });

  it('ordnet gesperrt vor nicht online vor belegt vor nicht für dich', () => {
    const seats = [
      seat('1', 0, { blocked: true, onlineSellable: false }),
      seat('2', 1, { onlineSellable: false }),
      seat('3', 3),
      seat('4', 4),
    ];
    expect(
      states({
        seats,
        occupations: [
          occupied('1', 1, 3, 'MALE'),
          occupied('2', 1, 3, 'MALE'),
          occupied('3', 1, 3, 'MALE'),
        ],
      }),
    ).toEqual({ '1': 'BLOCKED', '2': 'NOT_ONLINE', '3': 'TAKEN', '4': 'NOT_FOR_YOU' });
  });

  it('enthält kein Geschlecht anderer Fahrgäste', () => {
    const map = computeSeatMap({
      seats: SEATS,
      occupations: [occupied('1', 0, 3, 'MALE')],
      neighborsOf: NEIGHBORS,
      segment: { fromSeq: 0, toSeq: 3 },
      genderRuleEnabled: true,
      gender: 'FEMALE',
    });
    expect(JSON.stringify(map)).not.toMatch(/MALE|gender/);
  });

  it('verlangt bei aktiver Regel ein Geschlecht', () => {
    expect(() => states({ gender: null })).toThrow(TypeError);
  });
});

describe('Gekappte Verfügbarkeit', () => {
  it.each([
    [0, { available: 0, moreAvailable: false }],
    [9, { available: 9, moreAvailable: false }],
    [10, { available: 9, moreAvailable: true }],
    [45, { available: 9, moreAvailable: true }],
  ])('%i frei ergibt %o', (free, expected) => {
    expect(cappedAvailability(free)).toEqual(expected);
  });
});
