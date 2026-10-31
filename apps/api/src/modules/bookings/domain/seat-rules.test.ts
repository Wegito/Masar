import { describe, expect, it } from 'vitest';

import {
  hasGenderConflict,
  isSeatTaken,
  neighborMap,
  type Occupation,
  saleRestriction,
  segmentsOverlap,
} from './seat-rules.js';

// Damaskus 0 → Homs 1 → Hama 2 → Aleppo 3. Sitze 11 und 12 sind Nachbarn.
const NEIGHBORS = neighborMap([
  { seatId: '11', neighborSeatId: '12' },
  { seatId: '12', neighborSeatId: '11' },
]);

function man(seatId: string, fromSeq: number, toSeq: number, bookingId = 'b-man'): Occupation {
  return { seatId, fromSeq, toSeq, bookingId, gender: 'MALE' };
}

describe('Teilstrecken', () => {
  it.each([
    [{ fromSeq: 0, toSeq: 2 }, { fromSeq: 1, toSeq: 3 }, true],
    [{ fromSeq: 0, toSeq: 2 }, { fromSeq: 2, toSeq: 3 }, false],
    [{ fromSeq: 0, toSeq: 3 }, { fromSeq: 1, toSeq: 2 }, true],
    [{ fromSeq: 1, toSeq: 2 }, { fromSeq: 0, toSeq: 1 }, false],
  ])('%o und %o überlappen: %s', (a, b, expected) => {
    expect(segmentsOverlap(a, b)).toBe(expected);
    expect(segmentsOverlap(b, a)).toBe(expected);
  });

  it('sieht einen Sitz nur auf überlappender Teilstrecke als belegt', () => {
    const occupations = [man('11', 0, 2)];
    expect(isSeatTaken('11', { fromSeq: 1, toSeq: 3 }, occupations)).toBe(true);
    expect(isSeatTaken('11', { fromSeq: 2, toSeq: 3 }, occupations)).toBe(false);
    expect(isSeatTaken('12', { fromSeq: 0, toSeq: 3 }, occupations)).toBe(false);
  });
});

describe('Geschlechtsregel (ADR 0006)', () => {
  const base = { seatId: '12', neighborsOf: NEIGHBORS };

  it('meldet einen Konflikt, wenn ein fremder Mann auf überlappender Teilstrecke daneben sitzt', () => {
    expect(
      hasGenderConflict({
        ...base,
        gender: 'FEMALE',
        segment: { fromSeq: 1, toSeq: 3 },
        occupations: [man('11', 0, 2)],
      }),
    ).toBe(true);
  });

  it('ohne Überlappung der Teilstrecken gibt es keinen Konflikt', () => {
    expect(
      hasGenderConflict({
        ...base,
        gender: 'FEMALE',
        segment: { fromSeq: 2, toSeq: 3 },
        occupations: [man('11', 0, 2)],
      }),
    ).toBe(false);
  });

  it('gleiches Geschlecht daneben ist erlaubt', () => {
    expect(
      hasGenderConflict({
        ...base,
        gender: 'MALE',
        segment: { fromSeq: 0, toSeq: 3 },
        occupations: [man('11', 0, 2)],
      }),
    ).toBe(false);
  });

  it('nimmt Fahrgäste derselben Buchung aus (Familie, Paar)', () => {
    expect(
      hasGenderConflict({
        ...base,
        gender: 'FEMALE',
        bookingId: 'b-family',
        segment: { fromSeq: 0, toSeq: 3 },
        occupations: [man('11', 0, 3, 'b-family')],
      }),
    ).toBe(false);
  });

  it('zählt eine Belegung ohne Geschlechtsangabe als Konflikt (sicherer Fehlerfall)', () => {
    expect(
      hasGenderConflict({
        ...base,
        gender: 'MALE',
        segment: { fromSeq: 0, toSeq: 3 },
        occupations: [{ seatId: '11', fromSeq: 0, toSeq: 3, bookingId: 'b-x', gender: null }],
      }),
    ).toBe(true);
  });

  it('prüft nur Nachbarn, nicht Sitze über den Gang', () => {
    expect(
      hasGenderConflict({
        ...base,
        gender: 'FEMALE',
        segment: { fromSeq: 0, toSeq: 3 },
        occupations: [man('13', 0, 3)],
      }),
    ).toBe(false);
  });
});

describe('Kontingent je Kanal (ADR 0007)', () => {
  it.each([
    [{ onlineSellable: true, blocked: false }, 'ONLINE', null],
    [{ onlineSellable: false, blocked: false }, 'ONLINE', 'NOT_ONLINE'],
    [{ onlineSellable: false, blocked: false }, 'COUNTER', null],
    [{ onlineSellable: true, blocked: true }, 'ONLINE', 'BLOCKED'],
    [{ onlineSellable: false, blocked: true }, 'COUNTER', 'BLOCKED'],
    [{ onlineSellable: false, blocked: true }, 'ADMIN', 'BLOCKED'],
  ] as const)('%o über %s: %s', (seat, channel, expected) => {
    expect(saleRestriction(seat, channel)).toBe(expected);
  });
});
