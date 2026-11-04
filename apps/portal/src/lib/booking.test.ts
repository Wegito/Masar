import { describe, expect, it } from 'vitest';

import { bookingListQuery, EMPTY_FILTERS, historyActionKey, isUuid } from './booking';

describe('Query der Buchungsliste', () => {
  it('lässt leere Filter weg', () => {
    expect(bookingListQuery(EMPTY_FILTERS)).toBe('');
    expect(bookingListQuery({ ...EMPTY_FILTERS, q: '   ' })).toBe('');
  });

  it('setzt einen Tag als from und to, dazu Status, Zahlweg, Kanal, Suchtext und Cursor', () => {
    const query = bookingListQuery(
      {
        tripId: '0199f7a4-5c2e-7d3a-9b1e-2f4c6a8d0e12',
        day: ' 2026-11-07 ',
        status: 'RESERVED',
        paymentMethod: 'CASH',
        channel: 'COUNTER',
        q: ' 456 ',
      },
      { limit: 50, cursor: 'abc' },
    );
    expect(Object.fromEntries(new URLSearchParams(query ?? ''))).toEqual({
      tripId: '0199f7a4-5c2e-7d3a-9b1e-2f4c6a8d0e12',
      from: '2026-11-07',
      to: '2026-11-07',
      status: 'RESERVED',
      paymentMethod: 'CASH',
      channel: 'COUNTER',
      q: '456',
      limit: '50',
      cursor: 'abc',
    });
  });

  it('meldet einen ungültigen Tag, statt ihn zu senden', () => {
    expect(bookingListQuery({ ...EMPTY_FILTERS, day: '2026-02-30' })).toBeNull();
    expect(bookingListQuery({ ...EMPTY_FILTERS, day: '7.11.2026' })).toBeNull();
  });
});

describe('Hilfen der Buchungsseiten', () => {
  it('nimmt nur UUIDs aus der Adresse', () => {
    expect(isUuid('0199f7a4-5c2e-7d3a-9b1e-2f4c6a8d0e12')).toBe(true);
    expect(isUuid('ABCDEFGH')).toBe(false);
    expect(isUuid(['0199f7a4-5c2e-7d3a-9b1e-2f4c6a8d0e12'])).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });

  it('übersetzt bekannte Aktionen des Verlaufs und fasst unbekannte zusammen', () => {
    expect(historyActionKey('BOOKING_CONFIRMED_CASH')).toBe('BOOKING_CONFIRMED_CASH');
    expect(historyActionKey('BOOKING_CONTACT_REVEALED')).toBe('BOOKING_CONTACT_REVEALED');
    expect(historyActionKey('BOOKING_SOLD_AT_COUNTER')).toBe('BOOKING_SOLD_AT_COUNTER');
    expect(historyActionKey('SOMETHING_NEW')).toBe('OTHER');
  });
});
