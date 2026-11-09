import { describe, expect, it } from 'vitest';

import {
  cashDeadlineAt,
  holdExpiresAt,
  isPastDeadline,
  onlineSalesCloseAt,
  salesOpen,
} from './deadlines.js';

const at = (iso: string): Date => new Date(iso);
const departureAt = at('2026-11-10T07:00:00.000Z');

describe('Fristen', () => {
  it('hält einen Sitz hold_minutes lang, aber nie über die Abfahrt hinaus', () => {
    expect(holdExpiresAt(at('2026-11-10T05:00:00.000Z'), 15, departureAt)).toEqual(
      at('2026-11-10T05:15:00.000Z'),
    );
    expect(holdExpiresAt(at('2026-11-10T06:50:00.000Z'), 15, departureAt)).toEqual(departureAt);
  });

  it('nimmt die Barfrist der Fahrt, sonst die Minuten der Firma vor der Abfahrt', () => {
    const tripDeadline = at('2026-11-10T06:00:00.000Z');
    expect(
      cashDeadlineAt({ tripCashDeadlineAt: tripDeadline, departureAt, cashDeadlineMinutes: 120 }),
    ).toEqual(tripDeadline);
    expect(
      cashDeadlineAt({ tripCashDeadlineAt: null, departureAt, cashDeadlineMinutes: 120 }),
    ).toEqual(at('2026-11-10T05:00:00.000Z'));
  });

  it('rechnet den Verkaufsschluss aus den Minuten vor der Abfahrt', () => {
    expect(onlineSalesCloseAt(departureAt, 30)).toEqual(at('2026-11-10T06:30:00.000Z'));
  });

  it('schließt den Online-Verkauf mit online_sales_close_at, den Schalter erst mit der Abfahrt', () => {
    const close = at('2026-11-10T06:30:00.000Z');
    const input = { onlineSalesCloseAt: close, departureAt };
    expect(salesOpen({ ...input, channel: 'ONLINE', now: at('2026-11-10T06:29:59.999Z') })).toBe(
      true,
    );
    expect(salesOpen({ ...input, channel: 'ONLINE', now: close })).toBe(false);
    expect(salesOpen({ ...input, channel: 'COUNTER', now: close })).toBe(true);
    expect(salesOpen({ ...input, channel: 'ADMIN', now: departureAt })).toBe(false);
  });

  it('läuft für HELD am Hold-Ende ab, für RESERVED und PENDING_CONFIRMATION an der Frist', () => {
    const limit = at('2026-11-10T05:00:00.000Z');
    const before = at('2026-11-10T04:59:59.999Z');
    expect(isPastDeadline({ status: 'HELD', holdExpiresAt: limit, deadlineAt: null }, limit)).toBe(
      true,
    );
    expect(isPastDeadline({ status: 'HELD', holdExpiresAt: limit, deadlineAt: null }, before)).toBe(
      false,
    );
    // Für RESERVED zählt die Barfrist, nicht das alte Hold-Ende.
    expect(
      isPastDeadline({ status: 'RESERVED', holdExpiresAt: before, deadlineAt: limit }, before),
    ).toBe(false);
    expect(
      isPastDeadline(
        { status: 'PENDING_CONFIRMATION', holdExpiresAt: null, deadlineAt: limit },
        limit,
      ),
    ).toBe(true);
  });

  it('lässt bestätigte und beendete Buchungen nie ablaufen', () => {
    const past = at('2020-01-01T00:00:00.000Z');
    for (const status of ['CONFIRMED', 'CANCELLED', 'EXPIRED'] as const) {
      expect(isPastDeadline({ status, holdExpiresAt: past, deadlineAt: past }, departureAt)).toBe(
        false,
      );
    }
  });
});
