import { describe, expect, it } from 'vitest';

import { expandSchedule } from './trip-schedule.js';

const monWed = { weekdays: [1, 3], departureTime: '07:00', durationMinutes: 300 };

describe('expandSchedule', () => {
  it('liefert nur passende Wochentage, aufsteigend sortiert', () => {
    // 2026-11-08 ist Sonntag, 2026-11-09 Montag, 2026-11-11 Mittwoch.
    const trips = expandSchedule(monWed, '2026-11-08', '2026-11-15');
    expect(trips.map((t) => t.serviceDate)).toEqual(['2026-11-09', '2026-11-11']);
  });

  it('rechnet die Ortszeit Asia/Damascus in UTC um', () => {
    const [first] = expandSchedule(monWed, '2026-11-09', '2026-11-09');
    expect(first!.departureAt.toISOString()).toBe('2026-11-09T04:00:00.000Z');
    expect(first!.arrivalAt.toISOString()).toBe('2026-11-09T09:00:00.000Z');
  });

  it('Fahrt kurz nach Mitternacht gehoert zum Ortsdatum, nicht zum UTC-Datum', () => {
    const [trip] = expandSchedule(
      { weekdays: [2], departureTime: '00:30', durationMinutes: 60 },
      '2026-11-10',
      '2026-11-10',
    );
    expect(trip!.serviceDate).toBe('2026-11-10');
    expect(trip!.departureAt.toISOString()).toBe('2026-11-09T21:30:00.000Z');
  });

  it('Fahrt ueber Mitternacht: Ankunft am Folgetag', () => {
    const [trip] = expandSchedule(
      { weekdays: [4], departureTime: '23:00', durationMinutes: 480 },
      '2026-11-12',
      '2026-11-12',
    );
    expect(trip!.departureAt.toISOString()).toBe('2026-11-12T20:00:00.000Z');
    expect(trip!.arrivalAt.toISOString()).toBe('2026-11-13T04:00:00.000Z');
  });

  it('Grenzen sind inklusiv, ein Tag genuegt', () => {
    const all = { weekdays: [0, 1, 2, 3, 4, 5, 6], departureTime: '15:00', durationMinutes: 60 };
    expect(expandSchedule(all, '2026-11-09', '2026-11-09')).toHaveLength(1);
    expect(expandSchedule(all, '2026-11-09', '2026-11-15')).toHaveLength(7);
    expect(expandSchedule(all, '2026-11-01', '2027-01-01')).toHaveLength(62);
  });

  it('Reihenfolge der Wochentage in der Regel spielt keine Rolle', () => {
    const a = expandSchedule({ ...monWed, weekdays: [3, 1] }, '2026-11-08', '2026-11-15');
    expect(a.map((t) => t.serviceDate)).toEqual(['2026-11-09', '2026-11-11']);
  });

  it('kein passender Tag ergibt eine leere Liste', () => {
    expect(expandSchedule(monWed, '2026-11-12', '2026-11-14')).toEqual([]);
  });

  it('lehnt ungueltige Eingaben mit RangeError ab', () => {
    const ok = '2026-11-09';
    expect(() => expandSchedule({ ...monWed, weekdays: [] }, ok, ok)).toThrow(RangeError);
    expect(() => expandSchedule({ ...monWed, weekdays: [1, 1] }, ok, ok)).toThrow(RangeError);
    expect(() => expandSchedule({ ...monWed, weekdays: [7] }, ok, ok)).toThrow(RangeError);
    expect(() => expandSchedule({ ...monWed, weekdays: [1.5] }, ok, ok)).toThrow(RangeError);
    expect(() => expandSchedule({ ...monWed, departureTime: '7:00' }, ok, ok)).toThrow(RangeError);
    expect(() => expandSchedule({ ...monWed, departureTime: '24:00' }, ok, ok)).toThrow(RangeError);
    expect(() => expandSchedule({ ...monWed, departureTime: '12:60' }, ok, ok)).toThrow(RangeError);
    expect(() => expandSchedule({ ...monWed, durationMinutes: 0 }, ok, ok)).toThrow(RangeError);
    expect(() => expandSchedule({ ...monWed, durationMinutes: 2881 }, ok, ok)).toThrow(RangeError);
    expect(() => expandSchedule({ ...monWed, durationMinutes: 10.5 }, ok, ok)).toThrow(RangeError);
    expect(() => expandSchedule(monWed, '2026-02-30', ok)).toThrow(RangeError);
    expect(() => expandSchedule(monWed, 'morgen', ok)).toThrow(RangeError);
    expect(() => expandSchedule(monWed, '2026-11-10', '2026-11-09')).toThrow(RangeError);
    expect(() => expandSchedule(monWed, '2026-11-01', '2027-01-02')).toThrow(RangeError);
  });
});
