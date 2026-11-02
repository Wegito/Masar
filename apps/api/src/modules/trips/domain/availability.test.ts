import { describe, expect, it } from 'vitest';

import { capFreeSeats, FREE_SEATS_DISPLAY_CAP } from './availability.js';

describe('capFreeSeats', () => {
  it('zeigt kleine Zahlen exakt', () => {
    expect(capFreeSeats(0)).toEqual({ count: 0, capped: false });
    expect(capFreeSeats(8)).toEqual({ count: 8, capped: false });
  });

  it('kappt ab der Grenze, damit 9 und 40 gleich aussehen', () => {
    expect(FREE_SEATS_DISPLAY_CAP).toBe(9);
    expect(capFreeSeats(9)).toEqual({ count: 9, capped: true });
    expect(capFreeSeats(40)).toEqual(capFreeSeats(9));
  });

  it('nimmt eine andere Grenze an', () => {
    expect(capFreeSeats(5, 5)).toEqual({ count: 5, capped: true });
    expect(capFreeSeats(4, 5)).toEqual({ count: 4, capped: false });
  });

  it('lehnt negative und gebrochene Zahlen ab', () => {
    expect(() => capFreeSeats(-1)).toThrow(RangeError);
    expect(() => capFreeSeats(1.5)).toThrow(RangeError);
  });
});
