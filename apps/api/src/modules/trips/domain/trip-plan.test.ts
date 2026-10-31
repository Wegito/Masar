import { describe, expect, it } from 'vitest';

import { planTrip, type TripPlanInput, TripPlanError } from './trip-plan.js';

// Damaskus 23:00 → Homs → Hama → Aleppo; Ortszeit UTC+3. Die Fahrt endet am Folgetag.
const at = (iso: string): Date => new Date(iso);

const ROUTE_STOPS = [
  { routeStopId: 'rs-aleppo', stationId: 'st-aleppo', seq: 30 },
  { routeStopId: 'rs-damascus', stationId: 'st-damascus', seq: 0 },
  { routeStopId: 'rs-hama', stationId: 'st-hama', seq: 20 },
  { routeStopId: 'rs-homs', stationId: 'st-homs', seq: 10 },
];

const STOP_TIMES = [
  { arrivalAt: null, departureAt: at('2026-10-20T20:00:00Z') },
  { arrivalAt: at('2026-10-20T22:00:00Z'), departureAt: at('2026-10-20T22:10:00Z') },
  { arrivalAt: at('2026-10-20T22:50:00Z'), departureAt: at('2026-10-20T23:00:00Z') },
  { arrivalAt: at('2026-10-21T01:00:00Z'), departureAt: null },
];

const SEATS = [
  { seatId: 's1', label: '1', isSellable: true },
  { seatId: 's2', label: '2', isSellable: true },
  { seatId: 's3', label: '3', isSellable: true },
  { seatId: 's4', label: '4', isSellable: false },
];

const COMPANY = { genderRuleEnabled: true, onlineSalesCloseMinutes: 30, cashDeadlineMinutes: 120 };

function input(overrides: Partial<TripPlanInput> = {}): TripPlanInput {
  return {
    routeStops: ROUTE_STOPS,
    stopTimes: STOP_TIMES,
    seats: SEATS,
    company: COMPANY,
    ...overrides,
  };
}

describe('Fahrt planen', () => {
  it('ordnet die Halte nach der Route und nummeriert lückenlos ab 0', () => {
    const plan = planTrip(input());
    expect(plan.stops.map((s) => [s.seq, s.routeStopId])).toEqual([
      [0, 'rs-damascus'],
      [1, 'rs-homs'],
      [2, 'rs-hama'],
      [3, 'rs-aleppo'],
    ]);
  });

  it('übernimmt Abfahrt am ersten und Ankunft am letzten Halt; nur diese beiden fehlen', () => {
    const plan = planTrip(input());
    expect(plan.departureAt.toISOString()).toBe('2026-10-20T20:00:00.000Z');
    expect(plan.arrivalAt.toISOString()).toBe('2026-10-21T01:00:00.000Z');
    expect(plan.stops[0]?.arrivalAt).toBeNull();
    expect(plan.stops[3]?.departureAt).toBeNull();
  });

  it('legt den Fahrtag nach Ortszeit Damaskus fest, nicht nach UTC', () => {
    // 21:30 UTC ist 00:30 in Damaskus: die Fahrt gehört zum 21.10.
    const late = [
      { arrivalAt: null, departureAt: at('2026-10-20T21:30:00Z') },
      ...STOP_TIMES.slice(1),
    ];
    late[1] = { arrivalAt: at('2026-10-20T22:30:00Z'), departureAt: at('2026-10-20T22:40:00Z') };
    expect(planTrip(input()).serviceDate).toBe('2026-10-20');
    expect(planTrip(input({ stopTimes: late })).serviceDate).toBe('2026-10-21');
  });

  it('kopiert Geschlechtsregel und Fristen aus den Firmeneinstellungen', () => {
    const plan = planTrip(input());
    expect(plan.genderRuleEnabled).toBe(true);
    expect(plan.onlineSalesCloseAt.toISOString()).toBe('2026-10-20T19:30:00.000Z');
    expect(plan.cashDeadlineAt.toISOString()).toBe('2026-10-20T18:00:00.000Z');
    expect(
      planTrip(input({ company: { ...COMPANY, genderRuleEnabled: false } })).genderRuleEnabled,
    ).toBe(false);
  });

  it('setzt das Kontingent: Schaltersitze offline, gesperrte und unverkäufliche Sitze blockiert', () => {
    const plan = planTrip(input({ offlineSeatLabels: ['1'], blockedSeatLabels: ['2'] }));
    expect(plan.seats).toEqual([
      { seatId: 's1', onlineSellable: false, blocked: false },
      { seatId: 's2', onlineSellable: false, blocked: true },
      { seatId: 's3', onlineSellable: true, blocked: false },
      { seatId: 's4', onlineSellable: false, blocked: true },
    ]);
  });

  it('lehnt unbekannte Sitze im Kontingent ab, statt sie still zu ignorieren', () => {
    expect(() => planTrip(input({ offlineSeatLabels: ['99'] }))).toThrow(TripPlanError);
  });

  it.each([
    [
      'weniger als zwei Halte',
      input({ routeStops: ROUTE_STOPS.slice(0, 1), stopTimes: STOP_TIMES.slice(0, 1) }),
    ],
    ['Zeiten passen nicht zu den Halten', input({ stopTimes: STOP_TIMES.slice(0, 3) })],
    [
      'doppelte Position in der Route',
      input({ routeStops: [...ROUTE_STOPS.slice(0, 3), { ...ROUTE_STOPS[3]!, seq: 0 }] }),
    ],
    [
      'Zwischenhalt ohne Ankunft',
      input({
        stopTimes: [STOP_TIMES[0]!, { ...STOP_TIMES[1]!, arrivalAt: null }, ...STOP_TIMES.slice(2)],
      }),
    ],
    [
      'Abfahrt vor Ankunft',
      input({
        stopTimes: [
          STOP_TIMES[0]!,
          { arrivalAt: at('2026-10-20T22:10:00Z'), departureAt: at('2026-10-20T22:00:00Z') },
          ...STOP_TIMES.slice(2),
        ],
      }),
    ],
    [
      'Ankunft nicht nach der vorigen Abfahrt',
      input({
        stopTimes: [
          STOP_TIMES[0]!,
          { arrivalAt: at('2026-10-20T20:00:00Z'), departureAt: at('2026-10-20T22:10:00Z') },
          ...STOP_TIMES.slice(2),
        ],
      }),
    ],
    ['keine Sitze', input({ seats: [] })],
    ['negative Frist', input({ company: { ...COMPANY, cashDeadlineMinutes: -1 } })],
  ])('lehnt ab: %s', (_name, invalid) => {
    expect(() => planTrip(invalid)).toThrow(TripPlanError);
  });
});
