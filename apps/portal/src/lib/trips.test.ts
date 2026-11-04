import { describe, expect, it } from 'vitest';

import {
  addDays,
  canCancelTrip,
  canManageTrips,
  formatDeparture,
  type ScheduleDraft,
  scheduleBody,
  seatQuotaState,
  todayInDamascus,
  weekdayName,
} from './trips';

const ARABIC_INDIC_DIGIT = /[٠-٩۰-۹]/;

const DRAFT: ScheduleDraft = {
  routeId: 'route-1',
  vehicle: 'bus:bus-1',
  weekdays: [5, 0, 1],
  departureTime: '07:00',
  durationHours: '5',
  durationMinutes: '20',
  from: '2026-11-07',
  to: '2026-11-13',
  onlineSeats: '',
  genderRule: 'company',
  salesCloseMinutes: '',
};

describe('scheduleBody', () => {
  it('baut den Body für Vorschau und Veröffentlichung', () => {
    expect(scheduleBody(DRAFT)).toEqual({
      ok: true,
      body: {
        routeId: 'route-1',
        busId: 'bus-1',
        weekdays: [0, 1, 5],
        departureTime: '07:00',
        durationMinutes: 320,
        from: '2026-11-07',
        to: '2026-11-13',
      },
    });
  });

  it('nimmt Sitzplan statt Bus, Kontingent, Geschlechtsregel und Verkaufsschluss', () => {
    const result = scheduleBody({
      ...DRAFT,
      vehicle: 'layout:plan-1',
      onlineSeats: '36',
      genderRule: 'off',
      salesCloseMinutes: '60',
    });
    expect(result).toMatchObject({
      ok: true,
      body: {
        seatLayoutId: 'plan-1',
        onlineSeatCount: 36,
        genderRuleEnabled: false,
        onlineSalesCloseMinutes: 60,
      },
    });
    expect(result.ok && 'busId' in result.body).toBe(false);
  });

  it('meldet das erste unvollständige Feld', () => {
    expect(scheduleBody({ ...DRAFT, routeId: '' })).toEqual({ ok: false, field: 'routeId' });
    expect(scheduleBody({ ...DRAFT, vehicle: '' })).toEqual({ ok: false, field: 'vehicle' });
    expect(scheduleBody({ ...DRAFT, weekdays: [] })).toEqual({ ok: false, field: 'weekdays' });
    expect(scheduleBody({ ...DRAFT, departureTime: '7:00' })).toEqual({
      ok: false,
      field: 'departureTime',
    });
    expect(scheduleBody({ ...DRAFT, durationHours: '0', durationMinutes: '0' })).toEqual({
      ok: false,
      field: 'duration',
    });
    expect(scheduleBody({ ...DRAFT, durationHours: '٥' })).toEqual({
      ok: false,
      field: 'duration',
    });
    expect(scheduleBody({ ...DRAFT, to: '2026-11-06' })).toEqual({ ok: false, field: 'range' });
    expect(scheduleBody({ ...DRAFT, to: addDays(DRAFT.from, 62) })).toEqual({
      ok: false,
      field: 'range',
    });
    expect(scheduleBody({ ...DRAFT, onlineSeats: '-1' })).toEqual({
      ok: false,
      field: 'onlineSeats',
    });
  });
});

describe('Anzeige', () => {
  it('zeigt Abfahrten in Damaskus mit westlichen Ziffern und 24 Stunden', () => {
    // 20:30 UTC ist 23:30 in Damaskus.
    expect(formatDeparture('2026-11-05T20:30:00.000Z', 'en')).toContain('23:30');
    expect(formatDeparture('2026-11-05T20:30:00.000Z', 'ar')).toContain('23:30');
    expect(formatDeparture('2026-11-05T20:30:00.000Z', 'ar')).not.toMatch(ARABIC_INDIC_DIGIT);
  });

  it('nennt Wochentage ab Sonntag = 0', () => {
    expect(weekdayName(0, 'en')).toBe('Sunday');
    expect(weekdayName(6, 'en')).toBe('Saturday');
    expect(weekdayName(5, 'ar')).toBe('الجمعة');
  });

  it('rechnet Kalendertage und den heutigen Tag in Damaskus', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    // 21:30 UTC ist schon der Folgetag in Damaskus.
    expect(todayInDamascus(new Date('2026-11-04T21:30:00.000Z'))).toBe('2026-11-05');
  });

  it('ordnet Sitze dem Kanal zu, gesperrt geht vor', () => {
    const seat = {
      seatId: 's',
      label: '1A',
      row: 0,
      column: 0,
      side: 'LEFT' as const,
      isSellable: true,
      onlineSellable: true,
      blocked: false,
      occupied: false,
    };
    expect(seatQuotaState(seat)).toBe('ONLINE');
    expect(seatQuotaState({ ...seat, onlineSellable: false })).toBe('COUNTER');
    expect(seatQuotaState({ ...seat, blocked: true })).toBe('BLOCKED');
  });

  it('erlaubt Planen nur Admins und Absagen nur geplanten Fahrten', () => {
    expect(canManageTrips('ADMIN')).toBe(true);
    expect(canManageTrips('AGENT')).toBe(false);
    expect(canManageTrips('DRIVER')).toBe(false);
    expect(canCancelTrip({ status: 'SCHEDULED' })).toBe(true);
    expect(canCancelTrip({ status: 'CANCELLED' })).toBe(false);
  });
});
