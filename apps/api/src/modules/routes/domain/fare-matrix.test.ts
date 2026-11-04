import { farePairCount } from '@masar/shared';
import { describe, expect, it } from 'vitest';

import { type FareItem, fareMatrixIssue, farePairs } from './fare-matrix.js';

/** Matrix aus Teilstrecken-Preisen als Summe der Abschnitte, wie der Vorschlag im Portal. */
function summed(legs: number[]): FareItem[] {
  return farePairs(legs.length + 1).map(([fromSeq, toSeq]) => ({
    fromSeq,
    toSeq,
    amountMinor: legs.slice(fromSeq, toSeq).reduce((sum, leg) => sum + leg, 0),
  }));
}

// Seed-Tarife der Demo-Route (Damaskus, Homs, Hama, Aleppo) in Minor-Units.
const DEMO: FareItem[] = [
  { fromSeq: 0, toSeq: 1, amountMinor: 25_000 },
  { fromSeq: 0, toSeq: 2, amountMinor: 35_000 },
  { fromSeq: 0, toSeq: 3, amountMinor: 60_000 },
  { fromSeq: 1, toSeq: 2, amountMinor: 15_000 },
  { fromSeq: 1, toSeq: 3, amountMinor: 40_000 },
  { fromSeq: 2, toSeq: 3, amountMinor: 30_000 },
];

describe('farePairs', () => {
  it('liefert alle Paare in Fahrtrichtung, so viele wie farePairCount', () => {
    expect(farePairs(3)).toEqual([
      [0, 1],
      [0, 2],
      [1, 2],
    ]);
    for (const stops of [0, 1, 2, 4, 15]) {
      expect(farePairs(stops)).toHaveLength(farePairCount(stops));
    }
  });
});

describe('fareMatrixIssue', () => {
  it('nimmt eine vollständige, monotone Matrix an (Demo-Tarife, Summen, Einheitspreis)', () => {
    expect(fareMatrixIssue(4, DEMO)).toBeNull();
    expect(fareMatrixIssue(5, summed([100, 200, 300, 400]))).toBeNull();
    const flat = farePairs(3).map(([fromSeq, toSeq]) => ({ fromSeq, toSeq, amountMinor: 500 }));
    expect(fareMatrixIssue(3, flat)).toBeNull();
  });

  it('nimmt eine Strecke mit zwei Halten und einem Preis an', () => {
    expect(fareMatrixIssue(2, [{ fromSeq: 0, toSeq: 1, amountMinor: 1 }])).toBeNull();
  });

  it('meldet fehlende Teilstrecken mit Paar', () => {
    const issue = fareMatrixIssue(
      4,
      DEMO.filter((item) => !(item.fromSeq === 1 && item.toSeq === 3)),
    );
    expect(issue).toEqual({ code: 'FARE_MATRIX_INCOMPLETE', missing: [[1, 3]] });
    expect(fareMatrixIssue(3, [])).toEqual({
      code: 'FARE_MATRIX_INCOMPLETE',
      missing: [
        [0, 1],
        [0, 2],
        [1, 2],
      ],
    });
  });

  it('meldet Paare gegen die Fahrtrichtung, außerhalb der Strecke und doppelte', () => {
    const cases: [FareItem, [number, number]][] = [
      [{ fromSeq: 2, toSeq: 1, amountMinor: 100 }, [2, 1]],
      [{ fromSeq: 1, toSeq: 1, amountMinor: 100 }, [1, 1]],
      [{ fromSeq: 0, toSeq: 4, amountMinor: 100 }, [0, 4]],
      [{ fromSeq: -1, toSeq: 1, amountMinor: 100 }, [-1, 1]],
      [{ fromSeq: 0, toSeq: 1, amountMinor: 100 }, [0, 1]],
    ];
    for (const [extra, pair] of cases) {
      expect(fareMatrixIssue(4, [...DEMO, extra])).toEqual({
        code: 'FARE_MATRIX_INVALID',
        pairs: [pair],
      });
    }
  });

  it('meldet Beträge, die nicht ganzzahlig und positiv sind', () => {
    for (const amountMinor of [0, -100, 12.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
      const items = DEMO.map((item, index) => (index === 0 ? { ...item, amountMinor } : item));
      expect(fareMatrixIssue(4, items)).toEqual({ code: 'FARE_MATRIX_INVALID', pairs: [[0, 1]] });
    }
  });

  it('meldet eine Teilstrecke, die billiger ist als eine enthaltene', () => {
    // Damaskus–Aleppo billiger als Homs–Aleppo.
    const cheapThrough = DEMO.map((item) =>
      item.fromSeq === 0 && item.toSeq === 3 ? { ...item, amountMinor: 39_000 } : item,
    );
    expect(fareMatrixIssue(4, cheapThrough)).toEqual({
      code: 'FARE_NOT_MONOTONIC',
      pair: [0, 3],
      contained: [1, 3],
    });
    // Billiger als der erste Abschnitt.
    const cheapStart = DEMO.map((item) =>
      item.fromSeq === 0 && item.toSeq === 2 ? { ...item, amountMinor: 20_000 } : item,
    );
    expect(fareMatrixIssue(4, cheapStart)).toEqual({
      code: 'FARE_NOT_MONOTONIC',
      pair: [0, 2],
      contained: [0, 1],
    });
  });

  it('erkennt auch Verstöße gegen weiter innen liegende Teilstrecken über die Kette', () => {
    // 0–3 ist teurer als 0–2 und 1–3, aber 1–2 ist teurer als 0–2: Die Kette meldet 0–2.
    const items: FareItem[] = [
      { fromSeq: 0, toSeq: 1, amountMinor: 100 },
      { fromSeq: 0, toSeq: 2, amountMinor: 150 },
      { fromSeq: 0, toSeq: 3, amountMinor: 400 },
      { fromSeq: 1, toSeq: 2, amountMinor: 300 },
      { fromSeq: 1, toSeq: 3, amountMinor: 350 },
      { fromSeq: 2, toSeq: 3, amountMinor: 100 },
    ];
    expect(fareMatrixIssue(4, items)).toEqual({
      code: 'FARE_NOT_MONOTONIC',
      pair: [0, 2],
      contained: [1, 2],
    });
  });
});
