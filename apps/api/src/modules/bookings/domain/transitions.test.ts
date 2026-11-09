import { BOOKING_STATUSES, TICKET_STATUSES, TRIP_STATUSES } from '@masar/shared';
import { describe, expect, it } from 'vitest';

import {
  bookingTransition,
  canTransition,
  ticketTransition,
  tripTransition,
} from './transitions.js';

describe('Zustandsautomat Buchung', () => {
  it.each([
    ['HELD', 'RESERVED'],
    ['HELD', 'PENDING_CONFIRMATION'],
    ['HELD', 'CONFIRMED'],
    ['HELD', 'EXPIRED'],
    ['HELD', 'CANCELLED'],
    ['RESERVED', 'CONFIRMED'],
    ['RESERVED', 'EXPIRED'],
    ['RESERVED', 'CANCELLED'],
    ['PENDING_CONFIRMATION', 'CONFIRMED'],
    ['PENDING_CONFIRMATION', 'CANCELLED'],
    ['PENDING_CONFIRMATION', 'EXPIRED'],
    ['CONFIRMED', 'CANCELLED'],
  ] as const)('%s → %s ist erlaubt', (from, to) => {
    expect(bookingTransition(from, to)).toBe('APPLY');
    expect(canTransition('booking', from, to)).toBe(true);
  });

  it.each([
    ['RESERVED', 'HELD'],
    ['RESERVED', 'PENDING_CONFIRMATION'],
    ['CONFIRMED', 'EXPIRED'],
    ['CONFIRMED', 'RESERVED'],
    ['EXPIRED', 'CONFIRMED'],
    ['EXPIRED', 'CANCELLED'],
    ['CANCELLED', 'CONFIRMED'],
    ['CANCELLED', 'EXPIRED'],
  ] as const)('%s → %s ist verboten', (from, to) => {
    expect(bookingTransition(from, to)).toBe('REJECT');
    expect(canTransition('booking', from, to)).toBe(false);
  });

  it('behandelt jede Wiederholung desselben Zustands als No-op', () => {
    for (const status of BOOKING_STATUSES) {
      expect(bookingTransition(status, status)).toBe('NOOP');
      expect(canTransition('booking', status, status)).toBe(true);
    }
  });

  it('lässt aus Endzuständen nichts mehr zu', () => {
    for (const to of BOOKING_STATUSES) {
      for (const from of ['CANCELLED', 'EXPIRED'] as const) {
        expect(bookingTransition(from, to)).toBe(from === to ? 'NOOP' : 'REJECT');
      }
    }
  });
});

describe('Zustandsautomat Ticket', () => {
  it('erlaubt Check-in und Entwertung nur aus ISSUED', () => {
    expect(ticketTransition('ISSUED', 'CHECKED_IN')).toBe('APPLY');
    expect(ticketTransition('ISSUED', 'VOID')).toBe('APPLY');
    expect(ticketTransition('CHECKED_IN', 'VOID')).toBe('REJECT');
    expect(ticketTransition('VOID', 'CHECKED_IN')).toBe('REJECT');
    expect(ticketTransition('CHECKED_IN', 'ISSUED')).toBe('REJECT');
  });

  it('macht einen zweiten Check-in zum No-op', () => {
    for (const status of TICKET_STATUSES) {
      expect(ticketTransition(status, status)).toBe('NOOP');
    }
    expect(canTransition('ticket', 'CHECKED_IN', 'CHECKED_IN')).toBe(true);
  });
});

describe('Zustandsautomat Fahrt', () => {
  it('folgt DRAFT → SCHEDULED → DEPARTED → COMPLETED, Absage nur aus SCHEDULED', () => {
    expect(tripTransition('DRAFT', 'SCHEDULED')).toBe('APPLY');
    expect(tripTransition('SCHEDULED', 'DEPARTED')).toBe('APPLY');
    expect(tripTransition('DEPARTED', 'COMPLETED')).toBe('APPLY');
    expect(tripTransition('SCHEDULED', 'CANCELLED')).toBe('APPLY');
    expect(tripTransition('DEPARTED', 'CANCELLED')).toBe('REJECT');
    expect(tripTransition('DRAFT', 'DEPARTED')).toBe('REJECT');
    expect(tripTransition('COMPLETED', 'SCHEDULED')).toBe('REJECT');
    expect(canTransition('trip', 'CANCELLED', 'SCHEDULED')).toBe(false);
  });

  it('behandelt Wiederholungen als No-op', () => {
    for (const status of TRIP_STATUSES) {
      expect(tripTransition(status, status)).toBe('NOOP');
    }
  });
});
