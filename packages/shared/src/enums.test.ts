import { describe, expect, it } from 'vitest';

import {
  ACTIVE_BOOKING_STATUSES,
  BOOKING_STATUSES,
  TERMINAL_BOOKING_STATUSES,
  isActiveBookingStatus,
} from './enums.js';

describe('Buchungsstatus', () => {
  it('ist entweder aktiv (belegt Sitze) oder ein Endzustand, nie beides und nie keins', () => {
    for (const status of BOOKING_STATUSES) {
      const active = (ACTIVE_BOOKING_STATUSES as readonly string[]).includes(status);
      const terminal = (TERMINAL_BOOKING_STATUSES as readonly string[]).includes(status);
      expect(active !== terminal, status).toBe(true);
    }
  });

  it('erkennt aktive Status', () => {
    expect(isActiveBookingStatus('HELD')).toBe(true);
    expect(isActiveBookingStatus('CONFIRMED')).toBe(true);
    expect(isActiveBookingStatus('CANCELLED')).toBe(false);
    expect(isActiveBookingStatus('EXPIRED')).toBe(false);
  });
});
