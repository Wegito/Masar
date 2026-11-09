import { describe, expect, it } from 'vitest';

import {
  addMonthsClamped,
  coveredBusIds,
  daysBetween,
  defaultValidUntil,
  type LicensePeriod,
  licenseStanding,
  planningCheck,
} from './license-status.js';

function period(validFrom: string, validUntil: string, busPackages = 1): LicensePeriod {
  return {
    id: `${validFrom}..${validUntil}`,
    plan: 'ONE_YEAR',
    validFrom,
    validUntil,
    busPackages,
  };
}

/** Gültig bis einschließlich 2027-05-03. */
const FOUNDING: LicensePeriod = {
  id: 'founding',
  plan: 'FOUNDING',
  validFrom: '2026-11-04',
  validUntil: '2027-05-03',
  busPackages: 2,
};

describe('Laufzeit', () => {
  it('rechnet Monate wie PostgreSQL und kürzt auf das Monatsende', () => {
    expect(addMonthsClamped('2026-11-04', 6)).toBe('2027-05-04');
    expect(addMonthsClamped('2026-08-31', 6)).toBe('2027-02-28');
    expect(addMonthsClamped('2027-08-31', 6)).toBe('2028-02-29');
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsClamped('2026-12-15', 24)).toBe('2028-12-15');
  });

  it('endet einen Tag vor dem Monatsjahrestag', () => {
    expect(defaultValidUntil('FOUNDING', '2026-11-04')).toBe('2027-05-03');
    expect(defaultValidUntil('ONE_YEAR', '2027-05-04')).toBe('2028-05-03');
    expect(defaultValidUntil('TWO_YEARS', '2027-05-04')).toBe('2029-05-03');
    expect(defaultValidUntil('FOUNDING', '2026-08-31')).toBe('2027-02-27');
    expect(defaultValidUntil('ONE_YEAR', '2028-02-29')).toBe('2029-02-27');
  });

  it('zählt Kalendertage über Monats- und Jahresgrenzen', () => {
    expect(daysBetween('2026-12-30', '2027-01-02')).toBe(3);
    expect(daysBetween('2027-01-02', '2026-12-30')).toBe(-3);
  });
});

describe('Status zum Stichtag', () => {
  it('ist ACTIVE mit mehr als 30 Tagen und gibt die Busgrenze aus den Paketen', () => {
    const standing = licenseStanding([FOUNDING], '2026-11-04');
    expect(standing).toMatchObject({
      status: 'ACTIVE',
      period: FOUNDING,
      coveredUntil: '2027-05-03',
      daysUntilExpiry: 180,
      graceEndsOn: '2027-05-17',
      allowedBuses: 10,
      planningAllowed: true,
      upcoming: null,
    });
  });

  it('warnt ab 30 Tagen (EXPIRING_SOON) und ab 7 Tagen (EXPIRING_VERY_SOON)', () => {
    expect(licenseStanding([FOUNDING], '2027-04-02').status).toBe('ACTIVE'); // 31 Tage
    expect(licenseStanding([FOUNDING], '2027-04-03').status).toBe('EXPIRING_SOON'); // 30
    expect(licenseStanding([FOUNDING], '2027-04-25').status).toBe('EXPIRING_SOON'); // 8
    expect(licenseStanding([FOUNDING], '2027-04-26').status).toBe('EXPIRING_VERY_SOON'); // 7
  });

  it('der letzte gültige Tag ist noch gültig (0 Tage), der Folgetag ist Tag 1 der Kulanz', () => {
    const last = licenseStanding([FOUNDING], '2027-05-03');
    expect(last).toMatchObject({
      status: 'EXPIRING_VERY_SOON',
      daysUntilExpiry: 0,
      planningAllowed: true,
    });
    const grace = licenseStanding([FOUNDING], '2027-05-04');
    expect(grace).toMatchObject({
      status: 'GRACE',
      period: FOUNDING,
      daysUntilExpiry: -1,
      graceEndsOn: '2027-05-17',
      planningAllowed: true,
    });
  });

  it('Tag 14 der Kulanz erlaubt noch Planung, Tag 15 nicht mehr', () => {
    expect(licenseStanding([FOUNDING], '2027-05-17')).toMatchObject({
      status: 'GRACE',
      daysUntilExpiry: -14,
      planningAllowed: true,
    });
    expect(licenseStanding([FOUNDING], '2027-05-18')).toMatchObject({
      status: 'EXPIRED',
      daysUntilExpiry: -15,
      graceEndsOn: '2027-05-17',
      planningAllowed: false,
      allowedBuses: 10,
    });
  });

  it('eine lückenlos anschließende Verlängerung zählt mit und unterdrückt die Warnung', () => {
    const renewal = period('2027-05-04', '2028-05-03', 3);
    const standing = licenseStanding([renewal, FOUNDING], '2027-04-30');
    expect(standing).toMatchObject({
      status: 'ACTIVE',
      period: FOUNDING,
      coveredUntil: '2028-05-03',
      allowedBuses: 10,
      upcoming: null,
    });
    // Am ersten Tag der Verlängerung gelten deren Pakete.
    expect(licenseStanding([FOUNDING, renewal], '2027-05-04')).toMatchObject({
      period: renewal,
      allowedBuses: 15,
    });
  });

  it('eine Verlängerung nach einer Lücke hebt die Warnung nicht auf und gilt erst ab Beginn', () => {
    const later = period('2027-06-01', '2028-05-31');
    expect(licenseStanding([FOUNDING, later], '2027-04-30')).toMatchObject({
      status: 'EXPIRING_VERY_SOON',
      coveredUntil: '2027-05-03',
      upcoming: later,
    });
    expect(licenseStanding([FOUNDING, later], '2027-05-20')).toMatchObject({
      status: 'EXPIRED',
      period: FOUNDING,
      upcoming: later,
      planningAllowed: false,
    });
    expect(licenseStanding([FOUNDING, later], '2027-06-01').status).toBe('ACTIVE');
  });

  it('ohne jeden gültigen oder früheren Zeitraum ist die Lizenz abgelaufen', () => {
    expect(licenseStanding([], '2026-11-04')).toMatchObject({
      status: 'EXPIRED',
      period: null,
      coveredUntil: null,
      allowedBuses: 0,
      planningAllowed: false,
    });
    const future = period('2026-12-01', '2027-11-30');
    expect(licenseStanding([future], '2026-11-04')).toMatchObject({
      status: 'EXPIRED',
      period: null,
      upcoming: future,
    });
  });
});

describe('Busgrenze', () => {
  const buses = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7'];

  it('deckt die ältesten aktiven Busse ab, 5 je Paket', () => {
    expect([...coveredBusIds(buses, 5)]).toEqual(['b1', 'b2', 'b3', 'b4', 'b5']);
    expect([...coveredBusIds(buses, 10)]).toEqual(buses);
    expect([...coveredBusIds(buses, 0)]).toEqual([]);
  });

  it('lehnt den sechsten Bus bei einem Paket ab, nicht den fünften', () => {
    const standing = { planningAllowed: true, allowedBuses: 5 };
    expect(planningCheck(standing, buses, 'b5')).toEqual({
      issue: null,
      busCovered: true,
      activeBuses: 7,
    });
    expect(planningCheck(standing, buses, 'b6')).toEqual({
      issue: 'LICENSE_BUS_LIMIT_EXCEEDED',
      busCovered: false,
      activeBuses: 7,
    });
  });

  it('prüft ohne Bus keine Busgrenze, und eine abgelaufene Lizenz geht vor', () => {
    expect(planningCheck({ planningAllowed: true, allowedBuses: 5 }, buses, null)).toEqual({
      issue: null,
      busCovered: null,
      activeBuses: 7,
    });
    expect(planningCheck({ planningAllowed: false, allowedBuses: 5 }, buses, 'b6').issue).toBe(
      'LICENSE_EXPIRED',
    );
    expect(planningCheck({ planningAllowed: false, allowedBuses: 5 }, buses, null).issue).toBe(
      'LICENSE_EXPIRED',
    );
  });
});
