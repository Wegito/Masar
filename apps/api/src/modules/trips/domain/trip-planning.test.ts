import { describe, expect, it } from 'vitest';

import {
  busConflicts,
  classifySchedule,
  datesWithoutFares,
  evenStopOffsets,
  onlineQuota,
  onlineSalesCloseAt,
  planQuotaChange,
  planStopTimes,
  scheduleInPast,
  sellableSeatCount,
  spansOverlap,
  stopOffsetsIssue,
  type TripSeatState,
} from './trip-planning.js';
import type { PlannedTrip } from './trip-schedule.js';

const at = (iso: string): Date => new Date(iso);

function trip(serviceDate: string, departure: string, arrival: string): PlannedTrip {
  return { serviceDate, departureAt: at(departure), arrivalAt: at(arrival) };
}

describe('Zeiten der Halte', () => {
  it('verteilt Zwischenhalte gleichmäßig auf ganze Minuten', () => {
    expect(evenStopOffsets(4, 300)).toEqual([100, 200]);
    expect(evenStopOffsets(3, 125)).toEqual([63]);
    expect(evenStopOffsets(2, 60)).toEqual([]);
  });

  it('setzt Abfahrt am Start, Ankunft am Ziel und gleiche Zeiten an Zwischenhalten', () => {
    const planned = trip('2026-11-10', '2026-11-10T04:00:00.000Z', '2026-11-10T09:00:00.000Z');
    expect(planStopTimes(4, planned, [120, 190])).toEqual([
      { seq: 0, arrivalAt: null, departureAt: at('2026-11-10T04:00:00.000Z') },
      {
        seq: 1,
        arrivalAt: at('2026-11-10T06:00:00.000Z'),
        departureAt: at('2026-11-10T06:00:00.000Z'),
      },
      {
        seq: 2,
        arrivalAt: at('2026-11-10T07:10:00.000Z'),
        departureAt: at('2026-11-10T07:10:00.000Z'),
      },
      { seq: 3, arrivalAt: at('2026-11-10T09:00:00.000Z'), departureAt: null },
    ]);
  });

  it('nimmt eigene Minuten nur passend zur Strecke, steigend und innerhalb der Fahrzeit an', () => {
    expect(stopOffsetsIssue(4, 300, undefined)).toBeNull();
    expect(stopOffsetsIssue(4, 300, [60, 200])).toBeNull();
    expect(stopOffsetsIssue(2, 300, [])).toBeNull();
    expect(stopOffsetsIssue(4, 300, [60])).toBe('TRIP_STOP_OFFSETS_INVALID');
    expect(stopOffsetsIssue(4, 300, [200, 60])).toBe('TRIP_STOP_OFFSETS_INVALID');
    expect(stopOffsetsIssue(4, 300, [60, 60])).toBe('TRIP_STOP_OFFSETS_INVALID');
    expect(stopOffsetsIssue(4, 300, [0, 60])).toBe('TRIP_STOP_OFFSETS_INVALID');
    expect(stopOffsetsIssue(4, 300, [60, 300])).toBe('TRIP_STOP_OFFSETS_INVALID');
    // Gleichmäßig geht nicht, wenn ein Abschnitt keine ganze Minute hätte.
    expect(stopOffsetsIssue(4, 2, undefined)).toBe('TRIP_STOP_OFFSETS_INVALID');
  });
});

describe('Busbelegung', () => {
  const span = (start: string, end: string) => ({ start: at(start), end: at(end) });

  it('behandelt Zeiträume halboffen: Ankunft und neue Abfahrt im selben Moment sind erlaubt', () => {
    const a = span('2026-11-10T04:00:00Z', '2026-11-10T09:00:00Z');
    expect(spansOverlap(a, span('2026-11-10T09:00:00Z', '2026-11-10T12:00:00Z'))).toBe(false);
    expect(spansOverlap(a, span('2026-11-10T08:59:00Z', '2026-11-10T12:00:00Z'))).toBe(true);
    expect(spansOverlap(a, span('2026-11-10T05:00:00Z', '2026-11-10T06:00:00Z'))).toBe(true);
  });

  it('findet Überschneidungen mit bestehenden und unter den neuen Fahrten', () => {
    const planned = [
      span('2026-11-10T04:00:00Z', '2026-11-10T09:00:00Z'),
      span('2026-11-11T04:00:00Z', '2026-11-12T06:00:00Z'),
      span('2026-11-12T04:00:00Z', '2026-11-12T09:00:00Z'),
      span('2026-11-13T04:00:00Z', '2026-11-13T09:00:00Z'),
    ];
    const existing = [span('2026-11-13T08:00:00Z', '2026-11-13T10:00:00Z')];
    expect(busConflicts(planned, existing)).toEqual([1, 2, 3]);
    expect(busConflicts(planned.slice(0, 1), [])).toEqual([]);
  });
});

describe('Kontingent', () => {
  const seats = [
    { id: 'c', rowIndex: 1, colIndex: 0, isSellable: true },
    { id: 'a', rowIndex: 0, colIndex: 0, isSellable: true },
    { id: 'x', rowIndex: 0, colIndex: 1, isSellable: false },
    { id: 'b', rowIndex: 0, colIndex: 2, isSellable: true },
  ];

  it('gibt ohne Angabe alle verkaufbaren Sitze online, nie die nicht verkaufbaren', () => {
    const quota = onlineQuota(seats, undefined);
    expect(Object.fromEntries(quota)).toEqual({ a: true, b: true, c: true, x: false });
    expect(sellableSeatCount(seats)).toBe(3);
  });

  it('gibt die vorderen Sitze online und lässt die hinteren dem Schalter', () => {
    expect(Object.fromEntries(onlineQuota(seats, 2))).toEqual({
      a: true,
      b: true,
      c: false,
      x: false,
    });
    expect([...onlineQuota(seats, 0).values()].every((value) => !value)).toBe(true);
  });
});

describe('Tarife je Fahrtag', () => {
  const full = [
    { fromSeq: 0, toSeq: 1, validFrom: '2026-11-01', validUntil: null },
    { fromSeq: 0, toSeq: 2, validFrom: '2026-11-01', validUntil: null },
    { fromSeq: 1, toSeq: 2, validFrom: '2026-11-01', validUntil: null },
  ];

  it('meldet keinen Tag, wenn jede Teilstrecke einen gültigen Tarif hat', () => {
    expect(datesWithoutFares(['2026-11-05', '2026-11-30'], 3, full)).toEqual([]);
  });

  it('meldet Tage vor dem ersten Stand, ab dem Ende und mit Lücken in der Matrix', () => {
    const ending = full.map((fare) => ({ ...fare, validUntil: '2026-11-10' }));
    expect(datesWithoutFares(['2026-10-31', '2026-11-09', '2026-11-10'], 3, ending)).toEqual([
      '2026-10-31',
      '2026-11-10',
    ]);
    expect(datesWithoutFares(['2026-11-05'], 3, full.slice(0, 2))).toEqual(['2026-11-05']);
  });
});

describe('Termine', () => {
  const now = at('2026-11-10T10:00:00.000Z');

  it('erkennt Termine in der Vergangenheit', () => {
    const later = [{ departureAt: at('2026-11-10T12:00:00.000Z') }];
    expect(scheduleInPast('2026-11-10', '2026-11-10', later, now)).toBe(false);
    expect(scheduleInPast('2026-11-09', '2026-11-10', later, now)).toBe(true);
    expect(scheduleInPast('2026-11-10', '2026-11-10', [{ departureAt: now }], now)).toBe(true);
  });

  it('überspringt vorhandene Fahrten und markiert Busüberschneidungen', () => {
    const planned = [
      trip('2026-11-11', '2026-11-11T04:00:00.000Z', '2026-11-11T09:00:00.000Z'),
      trip('2026-11-12', '2026-11-12T04:00:00.000Z', '2026-11-12T09:00:00.000Z'),
      trip('2026-11-13', '2026-11-13T04:00:00.000Z', '2026-11-13T09:00:00.000Z'),
    ];
    const items = classifySchedule(
      planned,
      [{ id: 'vorhanden', departureAt: at('2026-11-11T04:00:00.000Z') }],
      [
        // Die vorhandene Fahrt selbst belegt den Bus ebenfalls; ihr Termin zählt trotzdem als EXISTS.
        { start: at('2026-11-11T04:00:00.000Z'), end: at('2026-11-11T09:00:00.000Z') },
        { start: at('2026-11-13T08:00:00.000Z'), end: at('2026-11-13T12:00:00.000Z') },
      ],
    );
    expect(items.map((item) => [item.state, item.existingTripId])).toEqual([
      ['EXISTS', 'vorhanden'],
      ['NEW', null],
      ['BUS_CONFLICT', null],
    ]);
  });

  it('rechnet den Online-Verkaufsschluss vor der Abfahrt', () => {
    expect(onlineSalesCloseAt(at('2026-11-10T04:00:00.000Z'), 30)).toEqual(
      at('2026-11-10T03:30:00.000Z'),
    );
  });
});

describe('Kontingent einer Fahrt ändern', () => {
  const seats: TripSeatState[] = [
    { seatId: 's1', label: '1A', onlineSellable: true, occupied: false },
    { seatId: 's2', label: '1B', onlineSellable: true, occupied: true },
    { seatId: 's3', label: '1C', onlineSellable: false, occupied: false },
  ];

  it('wirkt nur auf Sitze, deren Wert sich ändert', () => {
    expect(
      planQuotaChange(seats, [
        { seatId: 's1', onlineSellable: false },
        { seatId: 's2', onlineSellable: true },
        { seatId: 's3', onlineSellable: true },
      ]),
    ).toEqual({
      kind: 'OK',
      changes: [
        { seatId: 's1', onlineSellable: false },
        { seatId: 's3', onlineSellable: true },
      ],
    });
  });

  it('lehnt belegte und unbekannte Sitze ab', () => {
    expect(planQuotaChange(seats, [{ seatId: 's2', onlineSellable: false }])).toEqual({
      kind: 'TRIP_SEAT_OCCUPIED',
      labels: ['1B'],
    });
    expect(planQuotaChange(seats, [{ seatId: 'fremd', onlineSellable: false }])).toEqual({
      kind: 'SEAT_UNKNOWN',
      seatIds: ['fremd'],
    });
  });
});
