import { describe, expect, it } from 'vitest';

import { afterFailure, OUTBOX_MAX_ATTEMPTS, retryDelayMs } from './retry.js';

describe('Wiederholung der Outbox', () => {
  it('verdoppelt die Wartezeit ab 30 Sekunden bis höchstens eine Stunde', () => {
    expect(retryDelayMs(1)).toBe(30_000);
    expect(retryDelayMs(2)).toBe(60_000);
    expect(retryDelayMs(5)).toBe(480_000);
    expect(retryDelayMs(20)).toBe(3_600_000);
    expect(() => retryDelayMs(0)).toThrow(RangeError);
  });

  it('gibt nach der Höchstzahl an Versuchen auf', () => {
    const now = new Date('2026-11-02T10:00:00.000Z');
    expect(afterFailure(1, now)).toEqual({
      status: 'PENDING',
      nextAttemptAt: new Date('2026-11-02T10:00:30.000Z'),
    });
    expect(afterFailure(OUTBOX_MAX_ATTEMPTS - 1, now).status).toBe('PENDING');
    expect(afterFailure(OUTBOX_MAX_ATTEMPTS, now)).toEqual({
      status: 'FAILED',
      nextAttemptAt: now,
    });
  });
});
