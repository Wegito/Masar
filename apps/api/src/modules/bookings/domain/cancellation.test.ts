import { describe, expect, it } from 'vitest';

import { cancellationFeeBps, decideCancellation } from './cancellation.js';

const departureAt = new Date('2026-11-10T07:00:00.000Z');
const hoursBefore = (hours: number): Date => new Date(departureAt.getTime() - hours * 3_600_000);
const rules = [
  { minMinutesBeforeDeparture: 24 * 60, feeBps: 0 },
  { minMinutesBeforeDeparture: 120, feeBps: 2_500 },
];
const base = {
  actor: 'PASSENGER' as const,
  status: 'CONFIRMED' as const,
  now: hoursBefore(48),
  departureAt,
  anyCheckedIn: false,
  allowPassengerCancel: true,
  rules,
};

describe('Gebührenstufen', () => {
  it('nimmt die größte erreichte Stufe, ohne Stufen gebührenfrei, zu spät ergibt null', () => {
    expect(cancellationFeeBps(rules, 48 * 60)).toBe(0);
    expect(cancellationFeeBps(rules, 24 * 60)).toBe(0);
    expect(cancellationFeeBps(rules, 24 * 60 - 1)).toBe(2_500);
    expect(cancellationFeeBps(rules, 120)).toBe(2_500);
    expect(cancellationFeeBps(rules, 119)).toBeNull();
    expect(cancellationFeeBps([], 1)).toBe(0);
  });
});

describe('Storno durch Fahrgast', () => {
  it('erlaubt eine bestätigte Buchung nach Stornoregel mit Gebühr', () => {
    expect(decideCancellation(base)).toEqual({ kind: 'ALLOWED', feeBps: 0 });
    expect(decideCancellation({ ...base, now: hoursBefore(3) })).toEqual({
      kind: 'ALLOWED',
      feeBps: 2_500,
    });
  });

  it('lehnt nach Frist, nach Abfahrt, nach Check-in und bei gesperrter Regel ab', () => {
    const notCancellable = { kind: 'REJECTED', code: 'BOOKING_NOT_CANCELLABLE' };
    expect(decideCancellation({ ...base, now: hoursBefore(1) })).toEqual(notCancellable);
    expect(decideCancellation({ ...base, now: departureAt })).toEqual(notCancellable);
    expect(decideCancellation({ ...base, anyCheckedIn: true })).toEqual(notCancellable);
    expect(decideCancellation({ ...base, allowPassengerCancel: false })).toEqual(notCancellable);
  });

  it('gibt unbezahlte Buchungen bis zur Abfahrt immer frei, auch bei gesperrter Regel', () => {
    for (const status of ['HELD', 'RESERVED'] as const) {
      expect(
        decideCancellation({ ...base, status, now: hoursBefore(0.1), allowPassengerCancel: false }),
      ).toEqual({ kind: 'ALLOWED', feeBps: 0 });
    }
  });

  it('überlässt PENDING_CONFIRMATION dem Personal und lehnt Endzustände ab', () => {
    expect(decideCancellation({ ...base, status: 'PENDING_CONFIRMATION' })).toEqual({
      kind: 'REJECTED',
      code: 'INVALID_STATE_TRANSITION',
    });
    expect(decideCancellation({ ...base, status: 'EXPIRED' })).toEqual({
      kind: 'REJECTED',
      code: 'INVALID_STATE_TRANSITION',
    });
  });

  it('macht ein zweites Storno zum No-op', () => {
    expect(decideCancellation({ ...base, status: 'CANCELLED' })).toEqual({ kind: 'NOOP' });
  });
});

describe('Storno durch Firma', () => {
  it('erlaubt jede aktive Buchung, auch nach der Abfahrt, aber nicht nach Check-in', () => {
    const company = { ...base, actor: 'COMPANY' as const, allowPassengerCancel: false };
    for (const status of ['HELD', 'RESERVED', 'PENDING_CONFIRMATION', 'CONFIRMED'] as const) {
      expect(decideCancellation({ ...company, status, now: departureAt })).toEqual({
        kind: 'ALLOWED',
        feeBps: 0,
      });
    }
    expect(decideCancellation({ ...company, anyCheckedIn: true })).toEqual({
      kind: 'REJECTED',
      code: 'BOOKING_NOT_CANCELLABLE',
    });
  });
});
