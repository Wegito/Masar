import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

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

/** Länge eines Verwaltungstokens (16 Bytes base64url); Lesetokens sind länger. */
export const MANAGE_TOKEN_LENGTH = 22;

/**
 * QR-Token eines Tickets, Version 1 (ADR 0022): HMAC-SHA-256 über Ticket-ID und `ticket.version`
 * mit einem serverseitigen Schlüssel, 256 Bit als base64url. Gespeichert wird weiter nur der
 * SHA-256 des Tokens; die Ticketseite kann es nach geprüftem Zugriff jederzeit neu ableiten, ohne
 * dass der Klartext in der Datenbank steht. Erhöhen von `version` entwertet einen alten QR-Code.
 */
export function deriveTicketToken(key: Uint8Array, ticketId: string, version: number): string {
  return createHmac('sha256', key)
    .update(`masar-ticket-qr:v1:${ticketId}:${String(version)}`, 'utf8')
    .digest('base64url');
}

/** Bytes des Ablaufzeitpunkts (Sekunden seit 1970, ohne Vorzeichen, Big Endian; reicht bis 2106). */
const ACCESS_EXPIRY_BYTES = 4;
/** Gekürzter HMAC: 160 Bit genügen gegen Fälschung bei Ratenbegrenzung und kurzer Laufzeit. */
const ACCESS_MAC_BYTES = 20;

function accessMac(key: Uint8Array, bookingId: string, expiresAtSeconds: number): Buffer {
  return createHmac('sha256', key)
    .update(`masar-booking-access:v1:${bookingId}:${String(expiresAtSeconds)}`, 'utf8')
    .digest()
    .subarray(0, ACCESS_MAC_BYTES);
}

/**
 * Kurzlebiges Lesetoken nach Code und Telefon (ADR 0009, 0022): Ablauf und HMAC über Buchungs-ID
 * und Ablauf, 24 Bytes als base64url (32 Zeichen). Zustandslos; nichts davon steht in der
 * Datenbank. Es gilt nur für diese Buchung und nur zum Lesen.
 */
export function signAccessToken(key: Uint8Array, bookingId: string, expiresAt: Date): string {
  const seconds = Math.floor(expiresAt.getTime() / 1000);
  const expiry = Buffer.alloc(ACCESS_EXPIRY_BYTES);
  expiry.writeUInt32BE(seconds);
  return Buffer.concat([expiry, accessMac(key, bookingId, seconds)]).toString('base64url');
}

/** Prüft ein Lesetoken in konstanter Zeit; abgelaufen, fremd oder kaputt ergibt `false`. */
export function verifyAccessToken(
  key: Uint8Array,
  bookingId: string,
  token: string,
  now: Date,
): boolean {
  const raw = Buffer.from(token, 'base64url');
  if (raw.length !== ACCESS_EXPIRY_BYTES + ACCESS_MAC_BYTES) {
    return false;
  }
  const seconds = raw.readUInt32BE(0);
  const expected = accessMac(key, bookingId, seconds);
  const matches = timingSafeEqual(raw.subarray(ACCESS_EXPIRY_BYTES), expected);
  return matches && seconds * 1000 > now.getTime();
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
