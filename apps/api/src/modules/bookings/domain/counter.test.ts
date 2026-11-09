import { describe, expect, it } from 'vitest';

import { computeCounterSeatMap, counterQuota, mergeRanges } from './counter.js';

const seats = [
  { id: '1A', isSellable: true },
  { id: '1B', isSellable: true },
  { id: '2A', isSellable: true },
  { id: '2B', isSellable: true },
  { id: '3A', isSellable: false },
];
const tripSeats = [
  { seatId: '1A', onlineSellable: true, blocked: false },
  { seatId: '1B', onlineSellable: true, blocked: false },
  { seatId: '2A', onlineSellable: false, blocked: false },
  { seatId: '2B', onlineSellable: false, blocked: true },
  { seatId: '3A', onlineSellable: true, blocked: false },
];
const neighbors = [
  { seatId: '1A', neighborSeatId: '1B' },
  { seatId: '2A', neighborSeatId: '2B' },
];

describe('Teilstrecken zusammenfassen', () => {
  it('fasst angrenzende und überlappende Strecken zusammen, getrennte nicht', () => {
    expect(
      mergeRanges([
        { fromSeq: 2, toSeq: 3 },
        { fromSeq: 0, toSeq: 2 },
      ]),
    ).toEqual([{ fromSeq: 0, toSeq: 3 }]);
    expect(
      mergeRanges([
        { fromSeq: 0, toSeq: 2 },
        { fromSeq: 1, toSeq: 3 },
      ]),
    ).toEqual([{ fromSeq: 0, toSeq: 3 }]);
    expect(
      mergeRanges([
        { fromSeq: 2, toSeq: 3 },
        { fromSeq: 0, toSeq: 1 },
      ]),
    ).toEqual([
      { fromSeq: 0, toSeq: 1 },
      { fromSeq: 2, toSeq: 3 },
    ]);
    expect(mergeRanges([{ fromSeq: 2, toSeq: 2 }])).toEqual([]);
  });

  it('ändert die Eingabe nicht', () => {
    const input = [
      { fromSeq: 0, toSeq: 1 },
      { fromSeq: 1, toSeq: 2 },
    ];
    mergeRanges(input);
    expect(input).toEqual([
      { fromSeq: 0, toSeq: 1 },
      { fromSeq: 1, toSeq: 2 },
    ]);
  });
});

describe('Kontingent am Schalter', () => {
  it('unterscheidet online, Schalter und gesperrt; ohne Zeile oder nicht verkäuflich gesperrt', () => {
    expect(counterQuota(seats[0]!, tripSeats[0])).toBe('ONLINE');
    expect(counterQuota(seats[2]!, tripSeats[2])).toBe('COUNTER');
    expect(counterQuota(seats[3]!, tripSeats[3])).toBe('BLOCKED');
    expect(counterQuota(seats[4]!, tripSeats[4])).toBe('BLOCKED');
    expect(counterQuota(seats[0]!, undefined)).toBe('BLOCKED');
  });
});

describe('Sitzplan des Schalters', () => {
  it('zeigt Schalter-Sitze als frei, gesperrte als gesperrt und belegt nur bei Überlappung', () => {
    const map = computeCounterSeatMap({
      seats,
      tripSeats,
      occupations: [{ seatId: '1A', fromSeq: 0, toSeq: 2, gender: 'MALE' }],
      neighbors,
      segment: { fromSeq: 2, toSeq: 3 },
      genderRuleEnabled: false,
    });
    expect(map.get('1A')).toEqual({
      quota: 'ONLINE',
      state: 'FREE',
      occupiedRanges: [{ fromSeq: 0, toSeq: 2 }],
      selectableFor: null,
    });
    expect(map.get('2A')?.state).toBe('FREE');
    expect(map.get('2A')?.quota).toBe('COUNTER');
    expect(map.get('2B')?.state).toBe('BLOCKED');
    expect(map.get('3A')?.state).toBe('BLOCKED');

    const overlapping = computeCounterSeatMap({
      seats,
      tripSeats,
      occupations: [{ seatId: '1A', fromSeq: 0, toSeq: 2, gender: 'MALE' }],
      neighbors,
      segment: { fromSeq: 1, toSeq: 3 },
      genderRuleEnabled: false,
    });
    expect(overlapping.get('1A')?.state).toBe('TAKEN');
  });

  it('rechnet die Geschlechtsregel je Geschlecht nur für freie Sitze und nur bei Überlappung', () => {
    const occupations = [{ seatId: '1A', fromSeq: 0, toSeq: 2, gender: 'FEMALE' as const }];
    const map = computeCounterSeatMap({
      seats,
      tripSeats,
      occupations,
      neighbors,
      segment: { fromSeq: 0, toSeq: 3 },
      genderRuleEnabled: true,
    });
    expect(map.get('1B')?.selectableFor).toEqual({ FEMALE: true, MALE: false });
    expect(map.get('2A')?.selectableFor).toEqual({ FEMALE: true, MALE: true });
    // Belegt oder gesperrt: keine Angabe.
    expect(map.get('1A')?.selectableFor).toBeNull();
    expect(map.get('2B')?.selectableFor).toBeNull();

    const later = computeCounterSeatMap({
      seats,
      tripSeats,
      occupations,
      neighbors,
      segment: { fromSeq: 2, toSeq: 3 },
      genderRuleEnabled: true,
    });
    expect(later.get('1B')?.selectableFor).toEqual({ FEMALE: true, MALE: true });
  });

  it('zählt eine Belegung ohne Geschlecht als Konflikt für beide', () => {
    const map = computeCounterSeatMap({
      seats,
      tripSeats,
      occupations: [{ seatId: '1A', fromSeq: 0, toSeq: 3, gender: null }],
      neighbors,
      segment: { fromSeq: 0, toSeq: 3 },
      genderRuleEnabled: true,
    });
    expect(map.get('1B')?.selectableFor).toEqual({ FEMALE: false, MALE: false });
  });
});
