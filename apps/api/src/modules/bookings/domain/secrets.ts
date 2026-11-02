import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { encodeBookingCode } from '@masar/shared';

/**
 * Geheimnisse einer Buchung (ADR 0013, 0020). Die Zufallsquelle ist austauschbar, damit Tests
 * Kollisionen erzwingen können; im Betrieb ist es immer `crypto.randomBytes`.
 */
export type RandomSource = (size: number) => Uint8Array;

const secureRandom: RandomSource = (size) => randomBytes(size);

/** 8 Zeichen Crockford-Base32 aus 40 Bit kryptografischem Zufall. */
export function generateBookingCode(random: RandomSource = secureRandom): string {
  return encodeBookingCode(random(5));
}

export interface IssuedSecret {
  /** Geht genau einmal an den Fahrgast und wird nie gespeichert oder geloggt. */
  token: string;
  /** SHA-256 als Hex; nur das steht in der Datenbank. */
  hash: string;
}

/** SHA-256 als Hex. Ein einfacher Hash genügt, weil das Token mindestens 128 Bit Zufall hat. */
export function hashSecret(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function issue(bytes: number, random: RandomSource): IssuedSecret {
  const token = Buffer.from(random(bytes)).toString('base64url');
  return { token, hash: hashSecret(token) };
}

/** Verwaltungstoken der Gastbuchung: 128 Bit (ADR 0009, 0013). */
export function issueManageToken(random: RandomSource = secureRandom): IssuedSecret {
  return issue(16, random);
}

/** QR-Token eines Tickets, Version 1: 256 Bit Zufall, nur der Hash wird gespeichert (ADR 0013). */
export function issueTicketToken(random: RandomSource = secureRandom): IssuedSecret {
  return issue(32, random);
}

/** Vergleich in konstanter Zeit, damit die Antwortzeit nichts über den Hash verrät. */
export function secretMatches(token: string, storedHash: string | null): boolean {
  if (storedHash === null) {
    return false;
  }
  const actual = Buffer.from(hashSecret(token), 'hex');
  const expected = Buffer.from(storedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
