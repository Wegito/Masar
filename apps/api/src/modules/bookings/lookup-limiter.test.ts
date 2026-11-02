import { describe, expect, it } from 'vitest';

import { LOOKUP_ATTEMPTS_PER_CODE, LOOKUP_WINDOW_MS, LookupLimiter } from './lookup-limiter.js';

describe('Grenze je Buchungscode', () => {
  it('erlaubt zehn Versuche je Code und Stunde, danach mit Wartezeit', () => {
    const limiter = new LookupLimiter();
    const start = 1_000_000;
    for (let i = 0; i < LOOKUP_ATTEMPTS_PER_CODE; i++) {
      expect(limiter.hit('ABCDEFGH', start + i)).toEqual({ allowed: true });
    }
    expect(limiter.hit('ABCDEFGH', start + 60_000)).toEqual({
      allowed: false,
      retryAfterSeconds: (LOOKUP_WINDOW_MS - 60_000) / 1000,
    });
    // Andere Codes zählen getrennt.
    expect(limiter.hit('ZZZZZZZZ', start + 60_000)).toEqual({ allowed: true });
  });

  it('beginnt nach Ablauf des Fensters neu', () => {
    const limiter = new LookupLimiter();
    for (let i = 0; i <= LOOKUP_ATTEMPTS_PER_CODE; i++) {
      limiter.hit('ABCDEFGH', 0);
    }
    expect(limiter.hit('ABCDEFGH', 1).allowed).toBe(false);
    expect(limiter.hit('ABCDEFGH', LOOKUP_WINDOW_MS)).toEqual({ allowed: true });
  });

  it('setzt sich für Tests zurück', () => {
    const limiter = new LookupLimiter();
    for (let i = 0; i <= LOOKUP_ATTEMPTS_PER_CODE; i++) {
      limiter.hit('ABCDEFGH', 0);
    }
    limiter.reset();
    expect(limiter.hit('ABCDEFGH', 0)).toEqual({ allowed: true });
  });
});
