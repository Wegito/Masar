import { BOOKING_CODE_LENGTH, normalizeBookingCode } from '@masar/shared';
import { describe, expect, it } from 'vitest';

import {
  generateBookingCode,
  hashSecret,
  issueManageToken,
  issueTicketToken,
  secretMatches,
} from './secrets.js';

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
  it('hat 128 Bit (Verwaltung) und 256 Bit (Ticket) Zufall als base64url', () => {
    const manage = issueManageToken();
    const ticket = issueTicketToken();
    expect(Buffer.from(manage.token, 'base64url')).toHaveLength(16);
    expect(Buffer.from(ticket.token, 'base64url')).toHaveLength(32);
    expect(manage.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(issueTicketToken().token).not.toBe(ticket.token);
  });

  it('speichert nur den SHA-256-Hash und vergleicht in konstanter Zeit', () => {
    const { token, hash } = issueTicketToken();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(hash).toBe(hashSecret(token));
    expect(secretMatches(token, hash)).toBe(true);
    expect(secretMatches(`${token}x`, hash)).toBe(false);
    expect(secretMatches(token, null)).toBe(false);
    expect(secretMatches(token, 'abc')).toBe(false);
  });
});
