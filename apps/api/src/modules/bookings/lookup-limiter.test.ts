import { describe, expect, it } from 'vitest';

import {
  LOOKUP_ATTEMPTS_PER_CODE,
  LOOKUP_ATTEMPTS_PER_CODE_AND_CLIENT,
  LOOKUP_WINDOW_MS,
  LookupLimiter,
} from './lookup-limiter.js';

const ATTACKER = '198.51.100.9';
const PASSENGER = '203.0.113.7';

/** IP Nummer `n` aus einem eigenen /16, damit jede Runde ein neuer Client ist. */
function ipv4(n: number): string {
  return `10.${String(Math.floor(n / 256))}.${String(n % 256)}.1`;
}

describe('Grenze je Buchungscode und Client', () => {
  it('erlaubt zehn Versuche je Code, Client und Stunde, danach mit Wartezeit', () => {
    const limiter = new LookupLimiter();
    const start = 1_000_000;
    for (let i = 0; i < LOOKUP_ATTEMPTS_PER_CODE_AND_CLIENT; i++) {
      expect(limiter.hit('ABCDEFGH', ATTACKER, start + i)).toEqual({ allowed: true });
    }
    expect(limiter.hit('ABCDEFGH', ATTACKER, start + 60_000)).toEqual({
      allowed: false,
      retryAfterSeconds: (LOOKUP_WINDOW_MS - 60_000) / 1000,
    });
    // Andere Codes zählen getrennt.
    expect(limiter.hit('ZZZZZZZZ', ATTACKER, start + 60_000)).toEqual({ allowed: true });
  });

  it('sperrt einen fremden Code nur für den Client, der probiert, nicht für den Fahrgast', () => {
    const limiter = new LookupLimiter();
    for (let i = 0; i < 50; i++) {
      limiter.hit('ABCDEFGH', ATTACKER, 0);
    }
    expect(limiter.hit('ABCDEFGH', ATTACKER, 1).allowed).toBe(false);
    expect(limiter.hit('ABCDEFGH', PASSENGER, 1)).toEqual({ allowed: true });
  });

  it('zählt abgelehnte Versuche eines Clients nicht für die Grenze des Codes', () => {
    const limiter = new LookupLimiter();
    // Ein Client mit sehr vielen Versuchen verbraucht nur zehn vom gemeinsamen Kontingent.
    for (let i = 0; i < 1000; i++) {
      limiter.hit('ABCDEFGH', ATTACKER, 0);
    }
    for (let n = 0; n < LOOKUP_ATTEMPTS_PER_CODE - LOOKUP_ATTEMPTS_PER_CODE_AND_CLIENT; n++) {
      expect(limiter.hit('ABCDEFGH', ipv4(n), 1), `Client ${String(n)}`).toEqual({
        allowed: true,
      });
    }
  });

  it('begrenzt den Code über viele Clients auf hundert Versuche je Stunde', () => {
    const limiter = new LookupLimiter();
    const perClient = LOOKUP_ATTEMPTS_PER_CODE_AND_CLIENT;
    const clients = LOOKUP_ATTEMPTS_PER_CODE / perClient;
    for (let n = 0; n < clients; n++) {
      for (let i = 0; i < perClient; i++) {
        expect(limiter.hit('ABCDEFGH', ipv4(n), 0).allowed).toBe(true);
      }
    }
    // Danach hilft auch ein frischer Client nicht mehr, auch nicht der Fahrgast selbst.
    expect(limiter.hit('ABCDEFGH', PASSENGER, 1)).toEqual({
      allowed: false,
      retryAfterSeconds: LOOKUP_WINDOW_MS / 1000,
    });
    // Andere Codes sind nicht betroffen.
    expect(limiter.hit('ZZZZZZZZ', PASSENGER, 1)).toEqual({ allowed: true });
  });

  it('fasst IPv6 je /48 zusammen und IPv4-gemappte Adressen mit IPv4', () => {
    const limiter = new LookupLimiter();
    // Jede Adresse aus einem anderen /64, aber alle im selben /48.
    for (let i = 0; i < LOOKUP_ATTEMPTS_PER_CODE_AND_CLIENT; i++) {
      expect(limiter.hit('ABCDEFGH', `2001:db8:1:${i.toString(16)}::1`, 0).allowed).toBe(true);
    }
    expect(limiter.hit('ABCDEFGH', '2001:db8:1:ffff::2', 0).allowed).toBe(false);
    expect(limiter.hit('ABCDEFGH', '2001:db8:2::1', 0).allowed).toBe(true);

    for (let i = 0; i < LOOKUP_ATTEMPTS_PER_CODE_AND_CLIENT; i++) {
      limiter.hit('QQQQQQQQ', PASSENGER, 0);
    }
    expect(limiter.hit('QQQQQQQQ', `::ffff:${PASSENGER}`, 0).allowed).toBe(false);
  });

  it('zählt Anfragen ohne IP gemeinsam', () => {
    const limiter = new LookupLimiter();
    for (let i = 0; i < LOOKUP_ATTEMPTS_PER_CODE_AND_CLIENT; i++) {
      limiter.hit('ABCDEFGH', undefined, 0);
    }
    expect(limiter.hit('ABCDEFGH', undefined, 0).allowed).toBe(false);
    expect(limiter.hit('ABCDEFGH', PASSENGER, 0).allowed).toBe(true);
  });

  it('beginnt nach Ablauf des Fensters neu', () => {
    const limiter = new LookupLimiter();
    for (let i = 0; i <= LOOKUP_ATTEMPTS_PER_CODE_AND_CLIENT; i++) {
      limiter.hit('ABCDEFGH', ATTACKER, 0);
    }
    expect(limiter.hit('ABCDEFGH', ATTACKER, 1).allowed).toBe(false);
    expect(limiter.hit('ABCDEFGH', ATTACKER, LOOKUP_WINDOW_MS)).toEqual({ allowed: true });
  });

  it('setzt sich für Tests zurück', () => {
    const limiter = new LookupLimiter();
    for (let i = 0; i <= LOOKUP_ATTEMPTS_PER_CODE_AND_CLIENT; i++) {
      limiter.hit('ABCDEFGH', ATTACKER, 0);
    }
    limiter.reset();
    expect(limiter.hit('ABCDEFGH', ATTACKER, 0)).toEqual({ allowed: true });
  });
});
