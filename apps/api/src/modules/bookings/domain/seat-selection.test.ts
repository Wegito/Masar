import { describe, expect, it } from 'vitest';

import {
  checkGenderRule,
  checkSeatSelection,
  type ExistingOccupation,
  type TripSeatQuota,
} from './seat-selection.js';

const layoutSeats = ['1A', '1B', '1C', '9A', '9B', 'X'].map((id) => ({
  id,
  isSellable: id !== 'X',
}));
const tripSeats: TripSeatQuota[] = [
  { seatId: '1A', onlineSellable: true, blocked: false },
  { seatId: '1B', onlineSellable: true, blocked: false },
  { seatId: '1C', onlineSellable: true, blocked: false },
  { seatId: '9A', onlineSellable: false, blocked: false },
  { seatId: '9B', onlineSellable: true, blocked: true },
  { seatId: 'X', onlineSellable: true, blocked: false },
];
const segment = { fromSeq: 1, toSeq: 3 };

function occupation(seatId: string, fromSeq: number, toSeq: number): ExistingOccupation {
  return { seatId, fromSeq, toSeq, bookingId: 'other', gender: 'MALE' };
}

describe('Sitzwahl: Kontingent und Belegung', () => {
  const base = { channel: 'ONLINE' as const, layoutSeats, tripSeats, occupations: [], segment };

  it('akzeptiert freie Online-Sitze', () => {
    expect(checkSeatSelection({ ...base, requestedSeatIds: ['1A', '1B'] })).toEqual({ ok: true });
  });

  it('meldet Sitze außerhalb des Sitzplans zuerst', () => {
    expect(checkSeatSelection({ ...base, requestedSeatIds: ['9B', 'fremd'] })).toEqual({
      ok: false,
      code: 'SEAT_UNKNOWN',
      seatIds: ['fremd'],
    });
  });

  it('meldet gesperrte, nicht verkäufliche und kontingentlose Sitze als SEAT_BLOCKED', () => {
    const withoutQuota = tripSeats.filter((tripSeat) => tripSeat.seatId !== '1C');
    expect(
      checkSeatSelection({
        ...base,
        tripSeats: withoutQuota,
        requestedSeatIds: ['9B', 'X', '1C', '9A'],
      }),
    ).toEqual({ ok: false, code: 'SEAT_BLOCKED', seatIds: ['9B', 'X', '1C'] });
  });

  it('verlangt online das Kontingent, Schalter und Admin nicht (gesperrt bleibt gesperrt)', () => {
    expect(checkSeatSelection({ ...base, requestedSeatIds: ['9A'] })).toEqual({
      ok: false,
      code: 'SEAT_NOT_ONLINE',
      seatIds: ['9A'],
    });
    for (const channel of ['COUNTER', 'ADMIN'] as const) {
      expect(checkSeatSelection({ ...base, channel, requestedSeatIds: ['9A'] })).toEqual({
        ok: true,
      });
      expect(checkSeatSelection({ ...base, channel, requestedSeatIds: ['9B'] })).toMatchObject({
        code: 'SEAT_BLOCKED',
      });
    }
  });

  it('meldet Belegungen nur auf überlappenden Teilstrecken (halboffen)', () => {
    const occupations = [occupation('1A', 0, 1), occupation('1B', 3, 4), occupation('1C', 2, 4)];
    expect(
      checkSeatSelection({ ...base, occupations, requestedSeatIds: ['1A', '1B', '1C'] }),
    ).toEqual({ ok: false, code: 'SEAT_TAKEN', seatIds: ['1C'] });
  });
});

describe('Sitzwahl: Geschlechtsregel', () => {
  // 1A–1B nebeneinander, 1C ohne Nachbar; Hinterbank B1–B2–B3 als Kette.
  const neighbors = [
    { seatId: '1A', neighborSeatId: '1B' },
    { seatId: 'B1', neighborSeatId: 'B2' },
    { seatId: 'B2', neighborSeatId: 'B3' },
  ];
  const base = { enabled: true, neighbors, segment };

  it('verlangt das Geschlecht je Fahrgast, wenn die Regel aktiv ist', () => {
    expect(
      checkGenderRule({ ...base, occupations: [], passengers: [{ seatId: '1A', gender: null }] }),
    ).toEqual({ ok: false, code: 'GENDER_REQUIRED' });
  });

  it('prüft nichts, wenn die Fahrt die Regel nicht nutzt', () => {
    expect(
      checkGenderRule({
        ...base,
        enabled: false,
        occupations: [occupation('1B', 0, 4)],
        passengers: [{ seatId: '1A', gender: null }],
      }),
    ).toEqual({ ok: true });
  });

  it('meldet eine Frau neben einem Mann einer anderen Buchung auf überlappender Strecke', () => {
    expect(
      checkGenderRule({
        ...base,
        occupations: [occupation('1B', 2, 4)],
        passengers: [{ seatId: '1A', gender: 'FEMALE' }],
      }),
    ).toEqual({ ok: false, code: 'GENDER_RULE_CONFLICT', seatIds: ['1A'] });
  });

  it('erlaubt dasselbe Geschlecht und nicht überlappende Strecken', () => {
    expect(
      checkGenderRule({
        ...base,
        occupations: [occupation('1B', 2, 4)],
        passengers: [{ seatId: '1A', gender: 'MALE' }],
      }),
    ).toEqual({ ok: true });
    expect(
      checkGenderRule({
        ...base,
        occupations: [occupation('1B', 3, 4)],
        passengers: [{ seatId: '1A', gender: 'FEMALE' }],
      }),
    ).toEqual({ ok: true });
  });

  it('wertet eine Belegung ohne Geschlechtsangabe als Konflikt', () => {
    expect(
      checkGenderRule({
        ...base,
        occupations: [{ ...occupation('1B', 1, 2), gender: null }],
        passengers: [{ seatId: '1A', gender: 'MALE' }],
      }),
    ).toEqual({ ok: false, code: 'GENDER_RULE_CONFLICT', seatIds: ['1A'] });
  });

  it('nimmt Fahrgäste derselben Buchung aus, auch gegenüber eigenen Belegungen', () => {
    // Gemischtes Paar in einer neuen Buchung: kein Konflikt untereinander.
    expect(
      checkGenderRule({
        ...base,
        occupations: [],
        passengers: [
          { seatId: '1A', gender: 'FEMALE' },
          { seatId: '1B', gender: 'MALE' },
        ],
      }),
    ).toEqual({ ok: true });
    // Neubelegung einer bestehenden Buchung (z. B. bezahlt nach Ablauf, Phase 3).
    expect(
      checkGenderRule({
        ...base,
        bookingId: 'own',
        occupations: [{ ...occupation('1B', 1, 3), bookingId: 'own' }],
        passengers: [{ seatId: '1A', gender: 'FEMALE' }],
      }),
    ).toEqual({ ok: true });
  });

  it('schützt den mittleren Sitz der Hinterbank in beide Richtungen, den Einzelsitz nicht', () => {
    const occupations = [occupation('B1', 0, 4)];
    expect(
      checkGenderRule({ ...base, occupations, passengers: [{ seatId: 'B2', gender: 'FEMALE' }] }),
    ).toMatchObject({ code: 'GENDER_RULE_CONFLICT' });
    expect(
      checkGenderRule({
        ...base,
        occupations: [occupation('B3', 0, 4)],
        passengers: [{ seatId: 'B2', gender: 'FEMALE' }],
      }),
    ).toMatchObject({ code: 'GENDER_RULE_CONFLICT' });
    expect(
      checkGenderRule({
        ...base,
        occupations: [occupation('1B', 0, 4)],
        passengers: [{ seatId: '1C', gender: 'FEMALE' }],
      }),
    ).toEqual({ ok: true });
  });
});
