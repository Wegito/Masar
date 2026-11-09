import { describe, expect, it } from 'vitest';

import { effectiveBookingStatus, paymentStateOf } from './payment-state.js';

const NOW = new Date('2026-11-04T10:00:00.000Z');
const BEFORE = new Date('2026-11-04T09:59:00.000Z');
const AFTER = new Date('2026-11-04T10:01:00.000Z');

describe('Status für das Personal', () => {
  it('zeigt einen abgelaufenen Hold und eine abgelaufene Reservierung als EXPIRED', () => {
    expect(
      effectiveBookingStatus({ status: 'HELD', holdExpiresAt: BEFORE, deadlineAt: null }, NOW),
    ).toBe('EXPIRED');
    expect(
      effectiveBookingStatus({ status: 'HELD', holdExpiresAt: NOW, deadlineAt: null }, NOW),
    ).toBe('EXPIRED');
    expect(
      effectiveBookingStatus({ status: 'RESERVED', holdExpiresAt: null, deadlineAt: BEFORE }, NOW),
    ).toBe('EXPIRED');
    expect(
      effectiveBookingStatus(
        { status: 'PENDING_CONFIRMATION', holdExpiresAt: null, deadlineAt: BEFORE },
        NOW,
      ),
    ).toBe('EXPIRED');
  });

  it('lässt laufende Fristen und Endzustände unverändert', () => {
    expect(
      effectiveBookingStatus({ status: 'HELD', holdExpiresAt: AFTER, deadlineAt: null }, NOW),
    ).toBe('HELD');
    expect(
      effectiveBookingStatus({ status: 'RESERVED', holdExpiresAt: BEFORE, deadlineAt: AFTER }, NOW),
    ).toBe('RESERVED');
    expect(
      effectiveBookingStatus(
        { status: 'CONFIRMED', holdExpiresAt: BEFORE, deadlineAt: BEFORE },
        NOW,
      ),
    ).toBe('CONFIRMED');
    expect(
      effectiveBookingStatus({ status: 'CANCELLED', holdExpiresAt: BEFORE, deadlineAt: null }, NOW),
    ).toBe('CANCELLED');
  });
});

describe('Zahlungsstand', () => {
  it('folgt ohne payment-Zeilen aus Status und Bestätigung', () => {
    expect(paymentStateOf({ status: 'HELD', confirmedAt: null, payments: [] })).toBe('UNPAID');
    expect(paymentStateOf({ status: 'RESERVED', confirmedAt: null, payments: [] })).toBe(
      'CASH_DUE',
    );
    expect(
      paymentStateOf({ status: 'PENDING_CONFIRMATION', confirmedAt: null, payments: [] }),
    ).toBe('IN_REVIEW');
    expect(paymentStateOf({ status: 'CONFIRMED', confirmedAt: NOW, payments: [] })).toBe('PAID');
    expect(paymentStateOf({ status: 'EXPIRED', confirmedAt: null, payments: [] })).toBe('NONE');
    expect(paymentStateOf({ status: 'CANCELLED', confirmedAt: null, payments: [] })).toBe('NONE');
  });

  it('bleibt nach Storno einer bezahlten Buchung PAID (Erstattung erst in Phase 3)', () => {
    expect(paymentStateOf({ status: 'CANCELLED', confirmedAt: NOW, payments: [] })).toBe('PAID');
  });

  it('nutzt payment-Zeilen, sobald es sie gibt', () => {
    expect(
      paymentStateOf({ status: 'HELD', confirmedAt: null, payments: ['AWAITING_REVIEW'] }),
    ).toBe('IN_REVIEW');
    expect(
      paymentStateOf({ status: 'HELD', confirmedAt: null, payments: ['FAILED', 'SUCCEEDED'] }),
    ).toBe('PAID');
    expect(paymentStateOf({ status: 'HELD', confirmedAt: null, payments: ['FAILED'] })).toBe(
      'UNPAID',
    );
    expect(
      paymentStateOf({ status: 'EXPIRED', confirmedAt: null, payments: ['AWAITING_REVIEW'] }),
    ).toBe('NONE');
  });
});
