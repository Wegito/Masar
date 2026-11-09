import { describe, expect, it } from 'vitest';

import {
  parseCopy,
  statusNotice,
  storageKey,
  type TicketData,
  ticketHref,
  toTicketData,
  tokenFromFragment,
} from './ticket';
import type { TicketPageResponse } from './types';

const BOOKING_ID = '019a0000-0000-7000-8000-000000000001';
const MANAGE = 'AbCdEfGhIjKlMnOpQrStUv';
const ACCESS = 'AbCdEfGhIjKlMnOpQrStUvWxYz012345';

const STOP = {
  tripStopId: 's',
  nameAr: 'دمشق',
  nameEn: 'Damascus',
  arrivalAt: null,
  departureAt: null,
};

const RESPONSE: TicketPageResponse = {
  id: BOOKING_ID,
  bookingCode: 'ABCDEFGH',
  status: 'CONFIRMED',
  paymentMethod: 'CASH',
  holdExpiresAt: '2026-11-04T10:00:00.000Z',
  deadlineAt: '2026-11-04T18:00:00.000Z',
  total: { amountMinor: 80_000, currency: 'SYP' },
  trip: {
    id: 't',
    status: 'SCHEDULED',
    departureAt: '2026-11-04T20:00:00.000Z',
    company: { id: 'c', nameAr: 'شركة', nameEn: 'Company' },
  },
  from: STOP,
  to: STOP,
  stops: [STOP],
  passengers: [{ id: 'p', seatLabel: '2A', fullName: 'Lina Haddad', status: 'ACTIVE' }],
  tickets: [
    { id: 'k1', passengerId: 'p', seatLabel: '2A', status: 'ISSUED', qrToken: 'qr-token' },
    { id: 'k2', passengerId: 'p', seatLabel: '2B', status: 'VOID', qrToken: null },
  ],
};

describe('Token im Fragment', () => {
  it('liest Verwaltungs- und Lesetokens', () => {
    expect(tokenFromFragment(`#token=${MANAGE}`)).toBe(MANAGE);
    expect(tokenFromFragment(`token=${ACCESS}&x=1`)).toBe(ACCESS);
  });

  it('lehnt fehlende und ungültige Tokens ab', () => {
    expect(tokenFromFragment('')).toBeNull();
    expect(tokenFromFragment('#')).toBeNull();
    expect(tokenFromFragment('#token=kurz')).toBeNull();
    expect(tokenFromFragment('#token=<script>alert(1)</script>')).toBeNull();
    expect(tokenFromFragment(`#other=${MANAGE}`)).toBeNull();
  });

  it('baut den Link mit dem Token nur im Fragment', () => {
    const href = ticketHref('ar', BOOKING_ID, MANAGE);
    expect(href).toBe(`/ar/bookings/${BOOKING_ID}#token=${MANAGE}`);
    const url = new URL(href, 'https://masar.example');
    expect(url.pathname).not.toContain(MANAGE);
    expect(url.search).toBe('');
  });
});

describe('Ticketdaten für den Browser', () => {
  it('ersetzt das QR-Token durch die Geometrie und lässt leere QR-Codes leer', () => {
    const data = toTicketData(RESPONSE, (content) => ({
      size: content.length,
      path: 'M0 0h1v1h-1z',
    }));
    expect(data.tickets[0]).toEqual({
      id: 'k1',
      passengerId: 'p',
      seatLabel: '2A',
      status: 'ISSUED',
      qr: { size: 8, path: 'M0 0h1v1h-1z' },
    });
    expect(data.tickets[1]?.qr).toBeNull();
    expect(JSON.stringify(data)).not.toContain('qr-token');
  });
});

describe('Hinweis zum Stand', () => {
  const base = { holdExpiresAt: 'h', deadlineAt: 'd', trip: RESPONSE.trip };

  it('nennt Hold- und Barfrist', () => {
    expect(statusNotice({ ...base, status: 'HELD' })).toEqual({ key: 'held', until: 'h' });
    expect(statusNotice({ ...base, status: 'RESERVED' })).toEqual({
      key: 'reservedCash',
      until: 'd',
    });
  });

  it('deckt jeden Status ab', () => {
    expect(statusNotice({ ...base, status: 'PENDING_CONFIRMATION' }).key).toBe('pending');
    expect(statusNotice({ ...base, status: 'CONFIRMED' }).key).toBe('confirmed');
    expect(statusNotice({ ...base, status: 'CANCELLED' }).key).toBe('cancelled');
    expect(statusNotice({ ...base, status: 'EXPIRED' }).key).toBe('expired');
  });

  it('meldet eine gestrichene Fahrt vor dem Status der Buchung', () => {
    const trip = { ...RESPONSE.trip, status: 'CANCELLED' };
    expect(statusNotice({ ...base, trip, status: 'CONFIRMED' }).key).toBe('tripCancelled');
    expect(statusNotice({ ...base, trip, status: 'EXPIRED' }).key).toBe('expired');
  });
});

describe('Gespeicherte Kopie', () => {
  const ticket: TicketData = toTicketData(RESPONSE, () => ({ size: 1, path: '' }));
  const copy = JSON.stringify({ version: 1, savedAt: '2026-11-02T10:00:00.000Z', ticket });

  it('liest die eigene Kopie', () => {
    expect(parseCopy(copy, BOOKING_ID)?.ticket.bookingCode).toBe('ABCDEFGH');
    expect(storageKey(BOOKING_ID)).toBe(`masar.ticket.${BOOKING_ID}`);
  });

  it('ignoriert fehlende, fremde, kaputte und alte Einträge', () => {
    expect(parseCopy(null, BOOKING_ID)).toBeNull();
    expect(parseCopy(copy, '019a0000-0000-7000-8000-000000000002')).toBeNull();
    expect(parseCopy('{kaputt', BOOKING_ID)).toBeNull();
    expect(parseCopy('null', BOOKING_ID)).toBeNull();
    expect(parseCopy(JSON.stringify({ version: 0, savedAt: 'x', ticket }), BOOKING_ID)).toBeNull();
  });
});
