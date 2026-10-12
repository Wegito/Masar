import { describe, expect, it } from 'vitest';

import { lockDurationMs, MAX_LOCK_MS } from './lockout.js';

describe('Wartezeit nach Fehlversuchen', () => {
  it.each([
    [0, 0],
    [4, 0],
    [5, 60_000],
    [6, 120_000],
    [7, 240_000],
    [8, 480_000],
    [9, MAX_LOCK_MS],
    [50, MAX_LOCK_MS],
  ])('nach %i Fehlversuchen %i ms', (failedLogins, expected) => {
    expect(lockDurationMs(failedLogins)).toBe(expected);
  });
});
