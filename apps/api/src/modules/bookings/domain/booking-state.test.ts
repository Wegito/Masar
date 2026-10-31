import { BOOKING_STATUSES, CANCEL_ACTORS } from '@masar/shared';
import { describe, expect, it } from 'vitest';

import {
  canCancel,
  canTransition,
  holdExpiry,
  isDue,
  onlineBookingCutoff,
} from './booking-state.js';

const at = (iso: string) => new Date(iso);

describe('Zustandsübergänge der Buchung', () => {
  it.each([
    ['HELD', 'RESERVED', true],
    ['HELD', 'EXPIRED', true],
    ['RESERVED', 'CONFIRMED', true],
    ['RESERVED', 'HELD', false],
    ['CONFIRMED', 'CANCELLED', true],
    ['CONFIRMED', 'EXPIRED', false],
    ['CANCELLED', 'HELD', false],
    ['EXPIRED', 'CONFIRMED', false],
  ] as const)('%s → %s: %s', (from, to, expected) => {
    expect(canTransition(from, to)).toBe(expected);
  });

  it('Endzustände haben keine Ausgänge', () => {
    for (const to of BOOKING_STATUSES) {
      expect(canTransition('CANCELLED', to)).toBe(false);
      expect(canTransition('EXPIRED', to)).toBe(false);
    }
  });
});

describe('Wer darf stornieren (Entscheidung 2026-10-31)', () => {
  it('Fahrgäste nur ohne geflossenes Geld', () => {
    expect(BOOKING_STATUSES.filter((s) => canCancel(s, 'PASSENGER'))).toEqual(['HELD', 'RESERVED']);
  });

  it('die Firma auch bestätigte Buchungen, niemand eine beendete', () => {
    expect(canCancel('CONFIRMED', 'COMPANY')).toBe(true);
    for (const actor of CANCEL_ACTORS) {
      expect(canCancel('CANCELLED', actor)).toBe(false);
      expect(canCancel('EXPIRED', actor)).toBe(false);
    }
  });
});

describe('Fristen', () => {
  const trip = {
    onlineSalesCloseAt: at('2026-11-20T19:30:00Z'),
    cashDeadlineAt: at('2026-11-20T18:00:00Z'),
  };

  it('schließt die Online-Buchung bei der früheren Frist, solange nur bar möglich ist', () => {
    expect(onlineBookingCutoff(trip)).toEqual(trip.cashDeadlineAt);
    expect(onlineBookingCutoff({ ...trip, cashDeadlineAt: at('2026-11-20T20:00:00Z') })).toEqual(
      trip.onlineSalesCloseAt,
    );
  });

  it('gibt einem Hold die Minuten der Firma, aber nie mehr als bis zur Barfrist', () => {
    expect(holdExpiry(at('2026-11-20T12:00:00Z'), 15, trip)).toEqual(at('2026-11-20T12:15:00Z'));
    expect(holdExpiry(at('2026-11-20T17:55:00Z'), 15, trip)).toEqual(trip.cashDeadlineAt);
  });

  it.each([
    [{ status: 'HELD', holdExpiresAt: at('2026-11-20T12:00:00Z'), deadlineAt: null }, true],
    [{ status: 'HELD', holdExpiresAt: at('2026-11-20T12:00:01Z'), deadlineAt: null }, false],
    [{ status: 'RESERVED', holdExpiresAt: null, deadlineAt: at('2026-11-20T11:59:00Z') }, true],
    [{ status: 'RESERVED', holdExpiresAt: null, deadlineAt: at('2026-11-20T13:00:00Z') }, false],
    [{ status: 'CONFIRMED', holdExpiresAt: at('2026-11-20T11:00:00Z'), deadlineAt: null }, false],
  ] as const)('um 12:00 abgelaufen: %o → %s', (booking, expected) => {
    expect(isDue(booking, at('2026-11-20T12:00:00Z'))).toBe(expected);
  });
});
