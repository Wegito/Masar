import { localDateInDamascus } from '@masar/shared';
import { describe, expect, it } from 'vitest';

import { damascusDayRange } from './search-day.js';

describe('damascusDayRange', () => {
  it('beginnt um Mitternacht Ortszeit (21:00 UTC am Vortag, Syrien seit 2022 UTC+3)', () => {
    const { start, end } = damascusDayRange('2026-11-03');
    expect(start.toISOString()).toBe('2026-11-02T21:00:00.000Z');
    expect(end.toISOString()).toBe('2026-11-03T21:00:00.000Z');
  });

  it('ist halboffen: 23:59:59.999 gehört dazu, Mitternacht des Folgetags nicht', () => {
    const { start, end } = damascusDayRange('2026-11-03');
    const lastMs = new Date(end.getTime() - 1);
    expect(localDateInDamascus(start)).toBe('2026-11-03');
    expect(localDateInDamascus(lastMs)).toBe('2026-11-03');
    expect(localDateInDamascus(end)).toBe('2026-11-04');
  });

  it('rechnet über Monats- und Jahresgrenzen', () => {
    expect(damascusDayRange('2026-12-31').end.toISOString()).toBe('2026-12-31T21:00:00.000Z');
    expect(damascusDayRange('2028-02-29').start.toISOString()).toBe('2028-02-28T21:00:00.000Z');
  });

  it('folgt der Zone auch vor 2022, als Syrien noch Sommerzeit hatte', () => {
    // Juli 2021: UTC+3 (Sommerzeit), Januar 2021: UTC+2.
    expect(damascusDayRange('2021-07-01').start.toISOString()).toBe('2021-06-30T21:00:00.000Z');
    expect(damascusDayRange('2021-01-15').start.toISOString()).toBe('2021-01-14T22:00:00.000Z');
  });

  it('lehnt ungültige Tage ab', () => {
    expect(() => damascusDayRange('2026-02-30')).toThrow(RangeError);
    expect(() => damascusDayRange('03.11.2026')).toThrow(RangeError);
  });
});
