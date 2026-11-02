import { BOOKING_CODE_LENGTH, normalizeBookingCode } from '@masar/shared';
import { describe, expect, it } from 'vitest';

import {
  deriveTicketToken,
  generateBookingCode,
  hashSecret,
  issueManageToken,
  MANAGE_TOKEN_LENGTH,
  secretMatches,
  signAccessToken,
  verifyAccessToken,
} from './secrets.js';

const KEY = Buffer.alloc(32, 1);
const OTHER_KEY = Buffer.alloc(32, 2);
const BOOKING_ID = '019a0000-0000-7000-8000-000000000001';
const TICKET_ID = '019a0000-0000-7000-8000-0000000000aa';

describe('Buchungscode', () => {
  it('ist 8 Zeichen Crockford-Base32 und bereits normalisiert', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateBookingCode();
      expect(code).toHaveLength(BOOKING_CODE_LENGTH);
      expect(normalizeBookingCode(code)).toBe(code);
    }
  });

  it('nutzt genau 5 Bytes der Zufallsquelle', () => {
    const sizes: number[] = [];
    const code = generateBookingCode((size) => {
      sizes.push(size);
      return new Uint8Array(size);
    });
    expect(sizes).toEqual([5]);
    expect(code).toBe('00000000');
  });
});

describe('Tokens', () => {
  it('Verwaltungstoken hat 128 Bit Zufall als base64url', () => {
    const manage = issueManageToken();
    expect(Buffer.from(manage.token, 'base64url')).toHaveLength(16);
    expect(manage.token).toHaveLength(MANAGE_TOKEN_LENGTH);
    expect(manage.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(issueManageToken().token).not.toBe(manage.token);
  });

  it('speichert nur den SHA-256-Hash und vergleicht in konstanter Zeit', () => {
    const { token, hash } = issueManageToken();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(hash).toBe(hashSecret(token));
    expect(secretMatches(token, hash)).toBe(true);
    expect(secretMatches(`${token}x`, hash)).toBe(false);
    expect(secretMatches(token, null)).toBe(false);
    expect(secretMatches(token, 'abc')).toBe(false);
  });
});

describe('QR-Token eines Tickets (ADR 0022)', () => {
  it('ist stabil je Ticket und Version und hat 256 Bit', () => {
    const token = deriveTicketToken(KEY, TICKET_ID, 0);
    expect(deriveTicketToken(KEY, TICKET_ID, 0)).toBe(token);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('ändert sich mit Version, Ticket und Schlüssel', () => {
    const token = deriveTicketToken(KEY, TICKET_ID, 0);
    expect(deriveTicketToken(KEY, TICKET_ID, 1)).not.toBe(token);
    expect(deriveTicketToken(KEY, BOOKING_ID, 0)).not.toBe(token);
    expect(deriveTicketToken(OTHER_KEY, TICKET_ID, 0)).not.toBe(token);
  });
});

describe('Lesetoken nach Code und Telefon (ADR 0022)', () => {
  const now = new Date('2026-11-02T10:00:00.000Z');
  const expiresAt = new Date('2026-11-02T22:00:00.000Z');

  it('ist 32 Zeichen base64url und länger als ein Verwaltungstoken', () => {
    const token = signAccessToken(KEY, BOOKING_ID, expiresAt);
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(token.length).toBeGreaterThan(MANAGE_TOKEN_LENGTH);
  });

  it('gilt bis zum Ablauf, nur für diese Buchung und nur mit diesem Schlüssel', () => {
    const token = signAccessToken(KEY, BOOKING_ID, expiresAt);
    expect(verifyAccessToken(KEY, BOOKING_ID, token, now)).toBe(true);
    expect(verifyAccessToken(KEY, BOOKING_ID, token, new Date('2026-11-02T21:59:59.000Z'))).toBe(
      true,
    );
    expect(verifyAccessToken(KEY, BOOKING_ID, token, expiresAt)).toBe(false);
    expect(verifyAccessToken(KEY, TICKET_ID, token, now)).toBe(false);
    expect(verifyAccessToken(OTHER_KEY, BOOKING_ID, token, now)).toBe(false);
  });

  it('lehnt veränderte und kaputte Tokens ab', () => {
    const token = signAccessToken(KEY, BOOKING_ID, expiresAt);
    // Späterer Ablauf mit altem MAC: Die ersten Bytes sind der Zeitpunkt.
    const raw = Buffer.from(token, 'base64url');
    raw.writeUInt32BE(raw.readUInt32BE(0) + 3600);
    expect(verifyAccessToken(KEY, BOOKING_ID, raw.toString('base64url'), now)).toBe(false);
    expect(verifyAccessToken(KEY, BOOKING_ID, token.slice(0, 30), now)).toBe(false);
    expect(verifyAccessToken(KEY, BOOKING_ID, '', now)).toBe(false);
    expect(verifyAccessToken(KEY, BOOKING_ID, issueManageToken().token, now)).toBe(false);
  });
});
