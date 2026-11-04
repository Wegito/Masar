import { describe, expect, it } from 'vitest';

import ar from '../../messages/ar.json';
import en from '../../messages/en.json';
import {
  createLicenseBody,
  licenseBanner,
  type LicenseView,
  scheduleLicenseNotice,
  type ScheduleLicense,
  updateLicenseBody,
} from './license';

function view(overrides: Partial<LicenseView>): LicenseView {
  return {
    companyId: 'c',
    today: '2027-04-30',
    status: 'ACTIVE',
    plan: 'FOUNDING',
    validFrom: '2026-11-04',
    validUntil: '2027-05-03',
    coveredUntil: '2027-05-03',
    daysUntilExpiry: 3,
    graceEndsOn: '2027-05-17',
    planningAllowed: true,
    busPackages: 1,
    allowedBuses: 5,
    activeBuses: 1,
    busesOverLimit: 0,
    upcoming: null,
    periods: [],
    ...overrides,
  };
}

describe('Hinweis im Rahmen', () => {
  it('zeigt bei ACTIVE nichts', () => {
    expect(licenseBanner(view({ status: 'ACTIVE', daysUntilExpiry: 120 }))).toBeNull();
  });

  it('warnt 30 und 7 Tage vorher mit Tagen bis zum letzten gültigen Tag', () => {
    expect(licenseBanner(view({ status: 'EXPIRING_SOON', daysUntilExpiry: 20 }))).toEqual({
      kind: 'expiringSoon',
      tone: 'warning',
      days: 20,
      date: '2027-05-03',
    });
    expect(licenseBanner(view({ status: 'EXPIRING_VERY_SOON', daysUntilExpiry: 0 }))).toMatchObject(
      { kind: 'expiringVerySoon', days: 0 },
    );
  });

  it('nennt in der Kulanz die verbleibenden Tage bis zu ihrem letzten Tag', () => {
    expect(
      licenseBanner(
        view({ status: 'GRACE', today: '2027-05-04', daysUntilExpiry: -1, planningAllowed: true }),
      ),
    ).toEqual({ kind: 'grace', tone: 'danger', days: 13, date: '2027-05-17' });
    expect(licenseBanner(view({ status: 'GRACE', today: '2027-05-17' }))?.days).toBe(0);
  });

  it('meldet nach der Kulanz den Ablauf', () => {
    expect(
      licenseBanner(view({ status: 'EXPIRED', today: '2027-06-01', planningAllowed: false })),
    ).toEqual({ kind: 'expired', tone: 'danger', days: 0, date: '2027-05-03' });
  });

  it('hat jeden Text in ar und en', () => {
    for (const kind of ['expiringSoon', 'expiringVerySoon', 'grace', 'expired'] as const) {
      expect(ar.license.banner[kind]).toBeTruthy();
      expect(en.license.banner[kind]).toBeTruthy();
    }
    expect(Object.keys(ar.license).sort()).toEqual(Object.keys(en.license).sort());
  });
});

describe('Lizenz im Formular „Woche planen"', () => {
  const base: ScheduleLicense = {
    status: 'ACTIVE',
    planningAllowed: true,
    coveredUntil: '2027-05-03',
    daysUntilExpiry: 100,
    graceEndsOn: '2027-05-17',
    allowedBuses: 5,
    activeBuses: 6,
    busCovered: true,
    issue: null,
  };

  it('Sperren gehen vor Warnungen', () => {
    expect(scheduleLicenseNotice(undefined)).toBeNull();
    expect(scheduleLicenseNotice(base)).toBeNull();
    expect(scheduleLicenseNotice({ ...base, status: 'EXPIRING_SOON' })).toBe('expiring');
    expect(scheduleLicenseNotice({ ...base, status: 'GRACE' })).toBe('grace');
    expect(
      scheduleLicenseNotice({ ...base, status: 'GRACE', issue: 'LICENSE_BUS_LIMIT_EXCEEDED' }),
    ).toBe('busLimit');
    expect(scheduleLicenseNotice({ ...base, status: 'EXPIRED', issue: 'LICENSE_EXPIRED' })).toBe(
      'expired',
    );
  });
});

describe('Formular des Plattform-Admins', () => {
  const empty = { plan: '', validFrom: '', validUntil: '', busPackages: '', notes: '' } as const;

  it('neuer Zeitraum: nur der Plan ist Pflicht, leere Felder ergänzt die API', () => {
    expect(createLicenseBody({ ...empty, plan: 'ONE_YEAR' })).toEqual({
      ok: true,
      body: { plan: 'ONE_YEAR' },
    });
    expect(
      createLicenseBody({
        plan: 'TWO_YEARS',
        validFrom: '2027-05-04',
        validUntil: '2029-05-03',
        busPackages: ' 3 ',
        notes: ' R-17 ',
      }),
    ).toEqual({
      ok: true,
      body: {
        plan: 'TWO_YEARS',
        validFrom: '2027-05-04',
        validUntil: '2029-05-03',
        busPackages: 3,
        notes: 'R-17',
      },
    });
  });

  it('meldet das erste ungültige Feld', () => {
    expect(createLicenseBody({ ...empty })).toEqual({ ok: false, field: 'plan' });
    expect(createLicenseBody({ ...empty, plan: 'ONE_YEAR', validFrom: '2027-02-30' })).toEqual({
      ok: false,
      field: 'validFrom',
    });
    expect(
      createLicenseBody({
        ...empty,
        plan: 'ONE_YEAR',
        validFrom: '2027-05-04',
        validUntil: '2027-05-03',
      }),
    ).toEqual({ ok: false, field: 'validUntil' });
    for (const busPackages of ['0', '101', '1.5', '٣']) {
      expect(createLicenseBody({ ...empty, plan: 'ONE_YEAR', busPackages })).toEqual({
        ok: false,
        field: 'busPackages',
      });
    }
  });

  it('Zeitraum ändern schickt nur Geändertes', () => {
    const current = {
      validFrom: '2026-11-04',
      validUntil: '2027-05-03',
      busPackages: 1,
      notes: null,
    };
    expect(
      updateLicenseBody(
        { validFrom: '2026-11-04', validUntil: '2027-05-03', busPackages: '2', notes: '' },
        current,
      ),
    ).toEqual({ ok: true, body: { busPackages: 2 } });
    expect(
      updateLicenseBody(
        { validFrom: '2026-11-04', validUntil: '2027-06-30', busPackages: '1', notes: 'R-1' },
        current,
      ),
    ).toEqual({ ok: true, body: { validUntil: '2027-06-30', notes: 'R-1' } });
    expect(
      updateLicenseBody(
        { validFrom: '2026-11-04', validUntil: '2026-11-03', busPackages: '1', notes: '' },
        current,
      ),
    ).toEqual({ ok: false, field: 'validUntil' });
  });
});
