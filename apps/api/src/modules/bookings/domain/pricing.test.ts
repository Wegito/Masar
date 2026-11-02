import { describe, expect, it } from 'vitest';

import { basisPointsOf, MAX_INT4, priceBooking } from './pricing.js';

describe('Preisberechnung', () => {
  it('rechnet Tarif mal Fahrgäste in Minor-Units', () => {
    expect(priceBooking({ amountMinor: 60_000, currency: 'SYP' }, 3)).toEqual({
      fareAmountMinor: 60_000,
      totalAmountMinor: 180_000,
      currency: 'SYP',
    });
  });

  it('lehnt Fließkomma, negative Werte, null Fahrgäste und int4-Überlauf ab', () => {
    expect(() => priceBooking({ amountMinor: 100.5, currency: 'SYP' }, 1)).toThrow(RangeError);
    expect(() => priceBooking({ amountMinor: -1, currency: 'SYP' }, 1)).toThrow(RangeError);
    expect(() => priceBooking({ amountMinor: 100, currency: 'SYP' }, 0)).toThrow(RangeError);
    expect(() => priceBooking({ amountMinor: MAX_INT4, currency: 'SYP' }, 2)).toThrow(RangeError);
  });

  it('rundet Basispunkte kaufmännisch auf ganze Minor-Units', () => {
    expect(basisPointsOf(180_000, 300)).toBe(5_400);
    expect(basisPointsOf(150, 300)).toBe(5); // 4,5 → 5
    expect(basisPointsOf(149, 300)).toBe(4); // 4,47 → 4
    expect(basisPointsOf(MAX_INT4, 10_000)).toBe(MAX_INT4);
    expect(basisPointsOf(12_345, 0)).toBe(0);
    expect(() => basisPointsOf(100, 10_001)).toThrow(RangeError);
    expect(() => basisPointsOf(100, 1.5)).toThrow(RangeError);
  });
});
