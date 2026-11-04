import { describe, expect, it } from 'vitest';

import { encodeTripListCursor } from '../../trips/domain/trip-list-cursor.js';
import {
  bookingListRange,
  decodeBookingListCursor,
  encodeBookingListCursor,
  parseBookingSearch,
} from './booking-list.js';

describe('Cursor der Buchungsliste', () => {
  const cursor = {
    departureAt: new Date('2026-11-10T04:00:00.000Z'),
    bookingId: '0199f7a4-5c2e-7d3a-9b1e-2f4c6a8d0e12',
  };

  it('kodiert und dekodiert den Schlüssel des letzten Eintrags', () => {
    expect(decodeBookingListCursor(encodeBookingListCursor(cursor))).toEqual(cursor);
  });

  it('weist fremde, kaputte und vertauschte Werte zurück', () => {
    expect(decodeBookingListCursor('')).toBeNull();
    expect(decodeBookingListCursor('kein base64!')).toBeNull();
    expect(decodeBookingListCursor('A'.repeat(201))).toBeNull();
    expect(decodeBookingListCursor(Buffer.from('["b","x","y"]').toString('base64url'))).toBeNull();
    expect(
      decodeBookingListCursor(
        Buffer.from(JSON.stringify(['b', '2026-11-10', cursor.bookingId])).toString('base64url'),
      ),
    ).toBeNull();
    // Der Cursor der Fahrtenliste passt nicht, obwohl er dieselben Bausteine hat.
    expect(
      decodeBookingListCursor(
        encodeTripListCursor({ departureAt: cursor.departureAt, tripId: cursor.bookingId }),
      ),
    ).toBeNull();
  });
});

describe('Freitext der Buchungsliste', () => {
  it('liest den Anfang eines Buchungscodes wie normalizeBookingCode', () => {
    expect(parseBookingSearch('abcd')).toEqual({ codePrefix: 'ABCD', phoneSuffix: null });
    expect(parseBookingSearch('ab cd-ef')).toEqual({ codePrefix: 'ABCDEF', phoneSuffix: null });
    // Verwechselbare Zeichen nach Crockford.
    expect(parseBookingSearch('oIlx')).toEqual({ codePrefix: '011X', phoneSuffix: null });
    expect(parseBookingSearch('ABCD-EFGH')).toEqual({ codePrefix: 'ABCDEFGH', phoneSuffix: null });
  });

  it('liest Ziffern als Ende der Telefonnummer und, wenn passend, als Code-Anfang', () => {
    expect(parseBookingSearch('456')).toEqual({ codePrefix: null, phoneSuffix: '456' });
    expect(parseBookingSearch('3456')).toEqual({ codePrefix: '3456', phoneSuffix: '3456' });
    expect(parseBookingSearch('٤٥٦')).toEqual({ codePrefix: null, phoneSuffix: '456' });
  });

  it('kürzt eine ganze Nummer auf die letzten neun Ziffern', () => {
    expect(parseBookingSearch('0933 123 456')).toEqual({
      codePrefix: null,
      phoneSuffix: '933123456',
    });
    expect(parseBookingSearch('+963 933 123 456')).toEqual({
      codePrefix: null,
      phoneSuffix: '933123456',
    });
  });

  it('lehnt Namen, zu Kurzes, zu Langes und fremde Zeichen ab', () => {
    for (const input of ['', '  ', 'ab', '12', 'Lina Haddad', 'ABCDEFGHJ', 'AB%D', 'ABUD']) {
      expect(parseBookingSearch(input), input).toBeNull();
    }
    expect(parseBookingSearch('1'.repeat(33))).toBeNull();
    expect(parseBookingSearch('+12')).toBeNull();
  });
});

describe('Zeitraum der Buchungsliste', () => {
  const today = '2026-11-04';

  it('zeigt ohne Angaben die kommenden Abfahrten ab heute', () => {
    expect(bookingListRange({ hasSearch: false, today })).toEqual({ from: today, to: null });
  });

  it('ist mit Fahrt oder Suchtext offen', () => {
    expect(bookingListRange({ tripId: 'x', hasSearch: false, today })).toEqual({
      from: null,
      to: null,
    });
    expect(bookingListRange({ hasSearch: true, today })).toEqual({ from: null, to: null });
  });

  it('übernimmt ausdrückliche Tage, auch nur einen davon', () => {
    expect(
      bookingListRange({ from: '2026-11-01', to: '2026-11-01', hasSearch: true, today }),
    ).toEqual({ from: '2026-11-01', to: '2026-11-01' });
    expect(bookingListRange({ to: '2026-11-02', hasSearch: false, today })).toEqual({
      from: null,
      to: '2026-11-02',
    });
  });
});
