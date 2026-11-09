import { describe, expect, it } from 'vitest';

import { type IdempotentBooking, isSameBookingRequest } from './idempotency.js';

const existing: IdempotentBooking = {
  companyId: 'company-a',
  channel: 'COUNTER',
  tripId: 'trip',
  fromTripStopId: 'stop-0',
  toTripStopId: 'stop-3',
  seatIds: ['s1', 's2'],
};

const request = {
  companyId: 'company-a',
  channel: 'COUNTER' as const,
  tripId: 'trip',
  fromStopId: 'stop-0',
  toStopId: 'stop-3',
  seatIds: ['s2', 's1'],
};

describe('Wiederholung über den Idempotency-Key', () => {
  it('erkennt dieselbe Anfrage, auch mit Sitzen in anderer Reihenfolge', () => {
    expect(isSameBookingRequest(existing, request)).toBe(true);
  });

  it('lehnt anderen Kanal ab: ein Schalterschlüssel öffnet online kein Verwaltungstoken', () => {
    expect(isSameBookingRequest(existing, { ...request, companyId: null, channel: 'ONLINE' })).toBe(
      false,
    );
    expect(isSameBookingRequest({ ...existing, channel: 'ONLINE' }, request)).toBe(false);
  });

  it('lehnt eine andere Firma ab; die Gastbuchung prüft keine Firma', () => {
    expect(isSameBookingRequest(existing, { ...request, companyId: 'company-b' })).toBe(false);
    expect(
      isSameBookingRequest(
        { ...existing, channel: 'ONLINE' },
        { ...request, companyId: null, channel: 'ONLINE' },
      ),
    ).toBe(true);
  });

  it('lehnt andere Fahrt, Teilstrecke oder Sitzauswahl ab', () => {
    expect(isSameBookingRequest(existing, { ...request, tripId: 'other' })).toBe(false);
    expect(isSameBookingRequest(existing, { ...request, fromStopId: 'stop-1' })).toBe(false);
    expect(isSameBookingRequest(existing, { ...request, toStopId: 'stop-2' })).toBe(false);
    expect(isSameBookingRequest(existing, { ...request, seatIds: ['s1'] })).toBe(false);
    expect(isSameBookingRequest(existing, { ...request, seatIds: ['s1', 's3'] })).toBe(false);
  });
});
