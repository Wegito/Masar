import { randomUUID } from 'node:crypto';

import { localDateInDamascus } from '@masar/shared';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  addCalendarDays,
  daysBetween,
  defaultValidUntil,
} from '../src/modules/licenses/domain/license-status.js';
import { damascusDayRange } from '../src/modules/trips/domain/search-day.js';
import {
  createCompany,
  createStaff,
  createTestApp,
  loginAs,
  PASSWORD,
  resetDatabase,
  type TestApp,
} from './helpers/app.js';
import {
  bookingBody,
  createBookableTrip,
  guestPost,
  hold,
  waitUntilApiBlocked,
} from './helpers/bookings.js';
import { connectRaw } from './helpers/inventory.js';

/**
 * Lizenzstand je Firma gegen PostgreSQL (Schritt 2.7, ADR 0029 und 0032): Startstand neuer Firmen,
 * Lesen für alle Rollen, Pflege nur durch den Plattform-Admin, Mandantentrennung, Wirkung auf die
 * Fahrtplanung (gültig, Kulanz, abgelaufen, Busgrenze, Ablauf am Stichtag in Damaskus), Buchung,
 * Schalter und Storno bei abgelaufener Lizenz, Nebenläufigkeit mit echten Verbindungen.
 * Schema-Objekte: `licenses-schema.e2e.test.ts`, Log-Ausgabe: `licenses-logging.e2e.test.ts`.
 */

interface LicenseBody {
  companyId: string;
  today: string;
  status: string;
  plan: string | null;
  validFrom: string | null;
  validUntil: string | null;
  coveredUntil: string | null;
  daysUntilExpiry: number | null;
  graceEndsOn: string | null;
  planningAllowed: boolean;
  busPackages: number;
  allowedBuses: number;
  activeBuses: number;
  busesOverLimit: number;
  upcoming: { plan: string; validFrom: string; validUntil: string } | null;
  periods: Record<string, unknown>[];
}

interface AdminLicenseBody extends LicenseBody {
  company: { id: string };
  periodId: string | null;
  periods: {
    id: string;
    plan: string;
    validFrom: string;
    validUntil: string;
    busPackages: number;
    notes: string | null;
  }[];
}

interface ScheduleLicense {
  status: string;
  planningAllowed: boolean;
  issue: string | null;
  busCovered: boolean | null;
  allowedBuses: number;
  activeBuses: number;
}

const STANDARD_RULES = [{ minMinutesBeforeDeparture: 0, feeBps: 0 }];
const FARES = [
  { fromSeq: 0, toSeq: 1, amountMinor: 25_000 },
  { fromSeq: 0, toSeq: 2, amountMinor: 60_000 },
  { fromSeq: 1, toSeq: 2, amountMinor: 40_000 },
];
const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

function dateColumn(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

describe('Lizenzstand (Integration)', () => {
  let t: TestApp;
  let raw: pg.Client;
  let observer: pg.Client;
  let companyA: string;
  let companyB: string;
  let adminA: string;
  let agentA: string;
  let driverA: string;
  let adminB: string;
  let platform: string;
  let platformUserId: string;
  let stations: string[];
  let today: string;
  let routeA: string;
  let layoutA: string;
  let busA: string;

  beforeAll(async () => {
    t = await createTestApp();
    raw = await connectRaw();
    observer = await connectRaw();
  });

  afterAll(async () => {
    await raw.end();
    await observer.end();
    await t.app.close();
  });

  const base = (companyId: string): string => `/api/v1/companies/${companyId}`;
  const adminPath = (companyId: string): string => `/api/v1/admin/companies/${companyId}/license`;

  async function post<T>(cookie: string, path: string, body: object, status = 201): Promise<T> {
    const res = await t.http().post(path).set('Cookie', cookie).send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    return res.body as T;
  }

  async function license(companyId = companyA, cookie = adminA): Promise<LicenseBody> {
    const res = await t
      .http()
      .get(`${base(companyId)}/license`)
      .set('Cookie', cookie);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as LicenseBody;
  }

  async function createBus(companyId = companyA, cookie = adminA): Promise<string> {
    const bus = await post<{ id: string }>(cookie, `${base(companyId)}/buses`, {
      plate: `BUS ${randomUUID().slice(0, 6)}`,
      seatLayoutId: layoutA,
    });
    return bus.id;
  }

  /** Setzt den (einzigen) Lizenzzeitraum der Firma direkt in der Datenbank. */
  async function setPeriod(
    validUntil: string,
    options: { validFrom?: string; busPackages?: number; companyId?: string } = {},
  ): Promise<void> {
    const updated = await t.prisma.companyLicense.updateMany({
      where: { companyId: options.companyId ?? companyA },
      data: {
        validFrom: dateColumn(options.validFrom ?? addCalendarDays(validUntil, -200)),
        validUntil: dateColumn(validUntil),
        ...(options.busPackages === undefined ? {} : { busPackages: options.busPackages }),
      },
    });
    expect(updated.count).toBe(1);
  }

  function plan(overrides: object = {}): Record<string, unknown> {
    const tomorrow = addCalendarDays(localDateInDamascus(t.clock.now()), 1);
    return {
      routeId: routeA,
      busId: busA,
      weekdays: ALL_WEEKDAYS,
      departureTime: '07:00',
      durationMinutes: 240,
      from: tomorrow,
      to: tomorrow,
      ...overrides,
    };
  }

  function schedule(path: 'schedule' | 'schedule/preview', body: object, cookie = adminA) {
    return t
      .http()
      .post(`${base(companyA)}/trips/${path}`)
      .set('Cookie', cookie)
      .send(body);
  }

  async function preview(body: object = plan()): Promise<ScheduleLicense> {
    const res = await schedule('schedule/preview', body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return (res.body as { license: ScheduleLicense }).license;
  }

  beforeEach(async () => {
    await resetDatabase();
    t.resetRateLimits();
    today = localDateInDamascus(t.clock.now());
    companyA = (await createCompany(t.prisma, 'lizenz-a')).id;
    companyB = (await createCompany(t.prisma, 'lizenz-b')).id;
    const staff: [string, string, 'ADMIN' | 'AGENT' | 'DRIVER'][] = [
      ['admin@lizenz-a.example', companyA, 'ADMIN'],
      ['agent@lizenz-a.example', companyA, 'AGENT'],
      ['fahrer@lizenz-a.example', companyA, 'DRIVER'],
      ['admin@lizenz-b.example', companyB, 'ADMIN'],
    ];
    for (const [email, companyId, role] of staff) {
      await createStaff(t.prisma, {
        email,
        password: PASSWORD,
        memberships: [{ companyId, role }],
      });
    }
    platformUserId = (
      await createStaff(t.prisma, {
        email: 'betrieb@masar.example',
        password: PASSWORD,
        isPlatformAdmin: true,
      })
    ).id;
    adminA = await loginAs(t, 'admin@lizenz-a.example');
    agentA = await loginAs(t, 'agent@lizenz-a.example');
    driverA = await loginAs(t, 'fahrer@lizenz-a.example');
    adminB = await loginAs(t, 'admin@lizenz-b.example');
    platform = await loginAs(t, 'betrieb@masar.example');

    stations = [];
    for (const [slug, nameAr, nameEn] of [
      ['damascus', 'دمشق', 'Damascus'],
      ['homs', 'حمص', 'Homs'],
      ['aleppo', 'حلب', 'Aleppo'],
    ] as const) {
      const city = await t.prisma.city.create({ data: { slug, nameAr, nameEn } });
      const station = await t.prisma.station.create({
        data: { cityId: city.id, nameAr: `كراج ${nameAr}`, nameEn: `${nameEn} Terminal` },
      });
      stations.push(station.id);
    }
    const policy = await post<{ id: string }>(adminA, `${base(companyA)}/cancellation-policies`, {
      name: 'Standard',
      rules: STANDARD_RULES,
    });
    routeA = (
      await post<{ id: string }>(adminA, `${base(companyA)}/routes`, {
        nameAr: 'دمشق – حلب',
        nameEn: 'Damascus – Aleppo',
        cancellationPolicyId: policy.id,
        stops: stations,
        fares: { currency: 'SYP', items: FARES },
      })
    ).id;
    layoutA = (
      await post<{ id: string }>(adminA, `${base(companyA)}/seat-layouts`, {
        name: 'Standard 45',
        pattern: 'TWO_PLUS_TWO',
        rows: 10,
        backBench: 5,
      })
    ).id;
    busA = await createBus();
  });

  describe('Startstand', () => {
    it('jede neue Firma beginnt mit 6 Monaten FOUNDING ab dem Anlagetag, ein Paket', async () => {
      const body = await license();
      const validUntil = defaultValidUntil('FOUNDING', today);
      expect(body).toMatchObject({
        companyId: companyA,
        today,
        status: 'ACTIVE',
        plan: 'FOUNDING',
        validFrom: today,
        validUntil,
        coveredUntil: validUntil,
        daysUntilExpiry: daysBetween(today, validUntil),
        graceEndsOn: addCalendarDays(validUntil, 14),
        planningAllowed: true,
        busPackages: 1,
        allowedBuses: 5,
        activeBuses: 1,
        busesOverLimit: 0,
        upcoming: null,
      });
      expect(body.periods).toEqual([
        { plan: 'FOUNDING', validFrom: today, validUntil, busPackages: 1 },
      ]);
      // Die Firmensicht kennt weder Notiz noch IDs der Zeiträume.
      expect(JSON.stringify(body)).not.toMatch(/notes|createdBy/);
    });
  });

  describe('Rollen und Mandantentrennung', () => {
    it('alle Rollen der Firma und der Plattform-Admin lesen; eine fremde Firma nicht', async () => {
      for (const cookie of [adminA, agentA, driverA, platform]) {
        expect((await license(companyA, cookie)).plan).toBe('FOUNDING');
      }
      const foreign = await t
        .http()
        .get(`${base(companyA)}/license`)
        .set('Cookie', adminB);
      expect(foreign.status).toBe(403);
      expect(foreign.body).toMatchObject({ code: 'FORBIDDEN' });
    });

    it('nur der Plattform-Admin pflegt den Stand; Firmen-Admins nicht, auch nicht die eigene Firma', async () => {
      for (const cookie of [adminA, agentA, driverA, adminB]) {
        const list = await t.http().get('/api/v1/admin/companies').set('Cookie', cookie);
        expect(list.status).toBe(403);
        const read = await t.http().get(adminPath(companyA)).set('Cookie', cookie);
        expect(read.status).toBe(403);
        const create = await t
          .http()
          .post(adminPath(companyA))
          .set('Cookie', cookie)
          .send({ plan: 'TWO_YEARS', busPackages: 9 });
        expect(create.status).toBe(403);
        expect(create.body).toMatchObject({ code: 'FORBIDDEN' });
        const update = await t
          .http()
          .put(adminPath(companyA))
          .set('Cookie', cookie)
          .send({ busPackages: 9 });
        expect(update.status).toBe(403);
      }
      expect(await t.prisma.companyLicense.count({ where: { companyId: companyA } })).toBe(1);
      expect((await license()).busPackages).toBe(1);
      expect(await t.prisma.auditLog.count({ where: { entityType: 'company_license' } })).toBe(0);
    });

    it('eine Änderung an Firma A ändert nichts an Firma B', async () => {
      await t
        .http()
        .put(adminPath(companyA))
        .set('Cookie', platform)
        .send({ busPackages: 4, validUntil: addCalendarDays(today, 3) })
        .expect(200);
      expect(await license(companyA)).toMatchObject({
        busPackages: 4,
        status: 'EXPIRING_VERY_SOON',
      });
      expect(await license(companyB, adminB)).toMatchObject({ busPackages: 1, status: 'ACTIVE' });
      const list = await t
        .http()
        .get('/api/v1/admin/companies')
        .set('Cookie', platform)
        .expect(200);
      const items = (list.body as { items: { id: string; license: { busPackages: number } }[] })
        .items;
      expect(items.find((item) => item.id === companyA)?.license.busPackages).toBe(4);
      expect(items.find((item) => item.id === companyB)?.license.busPackages).toBe(1);
    });
  });

  describe('Pflege durch den Plattform-Admin', () => {
    it('verlängert lückenlos, ändert Pakete und schreibt Audit-Einträge nur mit IDs und Zahlen', async () => {
      const founding = await license();
      const renewal = await post<AdminLicenseBody>(platform, adminPath(companyA), {
        plan: 'ONE_YEAR',
        busPackages: 2,
        notes: 'Rechnung 2027-001',
      });
      const renewalFrom = addCalendarDays(founding.validUntil!, 1);
      const renewalUntil = defaultValidUntil('ONE_YEAR', renewalFrom);
      expect(
        renewal.periods.map(({ plan, validFrom, validUntil, busPackages }) => ({
          plan,
          validFrom,
          validUntil,
          busPackages,
        })),
      ).toEqual([
        { plan: 'FOUNDING', validFrom: today, validUntil: founding.validUntil, busPackages: 1 },
        { plan: 'ONE_YEAR', validFrom: renewalFrom, validUntil: renewalUntil, busPackages: 2 },
      ]);
      expect(renewal.periods[1]?.notes).toBe('Rechnung 2027-001');
      // Heute gilt noch die Gründungsphase, die Verlängerung zählt aber schon zur Abdeckung.
      expect(await license()).toMatchObject({
        plan: 'FOUNDING',
        coveredUntil: renewalUntil,
        busPackages: 1,
        status: 'ACTIVE',
      });

      // Pakete der laufenden Gründungsphase anheben (PUT ohne periodId: der heutige Zeitraum).
      const updated = await t
        .http()
        .put(adminPath(companyA))
        .set('Cookie', platform)
        .send({ busPackages: 3 })
        .expect(200);
      expect((updated.body as AdminLicenseBody).busPackages).toBe(3);
      // Den künftigen Zeitraum gezielt ändern; die Notiz leeren.
      const future = renewal.periods[1]!;
      await t
        .http()
        .put(adminPath(companyA))
        .set('Cookie', platform)
        .send({ periodId: future.id, plan: 'TWO_YEARS', notes: '' })
        .expect(200);
      const stored = await t.prisma.companyLicense.findUniqueOrThrow({ where: { id: future.id } });
      expect(stored).toMatchObject({
        plan: 'TWO_YEARS',
        notes: null,
        createdByUserId: platformUserId,
      });

      const audit = await t.prisma.auditLog.findMany({
        where: { entityType: 'company_license' },
        orderBy: { occurredAt: 'asc' },
      });
      expect(audit.map((entry) => entry.action)).toEqual([
        'LICENSE_PERIOD_CREATED',
        'LICENSE_PERIOD_UPDATED',
        'LICENSE_PERIOD_UPDATED',
      ]);
      expect(audit.every((entry) => entry.actorId === platformUserId)).toBe(true);
      expect(audit.every((entry) => entry.companyId === companyA)).toBe(true);
      expect(audit[1]?.data).toEqual({ busPackages: { from: 1, to: 3 }, notesChanged: false });
      expect(audit[2]?.data).toEqual({
        plan: { from: 'ONE_YEAR', to: 'TWO_YEARS' },
        notesChanged: true,
      });
      expect(JSON.stringify(audit)).not.toContain('Rechnung');
    });

    it('lehnt Überschneidungen, falsche Zeiträume, zu viele Pakete und unbekannte Firmen ab', async () => {
      const overlap = await t
        .http()
        .post(adminPath(companyA))
        .set('Cookie', platform)
        .send({ plan: 'ONE_YEAR', validFrom: addCalendarDays(today, 10) });
      expect(overlap.status).toBe(409);
      expect(overlap.body).toMatchObject({ code: 'LICENSE_PERIOD_OVERLAP' });

      const backwards = await t
        .http()
        .post(adminPath(companyA))
        .set('Cookie', platform)
        .send({ plan: 'ONE_YEAR', validFrom: '2030-01-10', validUntil: '2030-01-09' });
      expect(backwards.status).toBe(400);
      expect(backwards.body).toMatchObject({
        code: 'VALIDATION_FAILED',
        errors: [{ path: 'validUntil', rule: 'custom' }],
      });

      for (const body of [
        { busPackages: 0 },
        { busPackages: 101 },
        {},
        { notes: 'x'.repeat(201) },
      ]) {
        const res = await t.http().put(adminPath(companyA)).set('Cookie', platform).send(body);
        expect(res.status, JSON.stringify(body)).toBe(400);
      }
      const unknown = await t
        .http()
        .get(adminPath('0199f7a4-5c2e-7d3a-9b1e-2f4c6a8d0e12'))
        .set('Cookie', platform);
      expect(unknown.status).toBe(404);
      const unknownPeriod = await t
        .http()
        .put(adminPath(companyA))
        .set('Cookie', platform)
        .send({ periodId: '0199f7a4-5c2e-7d3a-9b1e-2f4c6a8d0e12', busPackages: 2 });
      expect(unknownPeriod.status).toBe(404);
      expect(unknownPeriod.body).toMatchObject({ code: 'LICENSE_NOT_FOUND' });
      // Ein Zeitraum der Firma B ist unter Firma A unbekannt.
      const foreignPeriod = await t.prisma.companyLicense.findFirstOrThrow({
        where: { companyId: companyB },
      });
      const crossed = await t
        .http()
        .put(adminPath(companyA))
        .set('Cookie', platform)
        .send({ periodId: foreignPeriod.id, busPackages: 2 });
      expect(crossed.body).toMatchObject({ code: 'LICENSE_NOT_FOUND' });
      expect(await t.prisma.companyLicense.count()).toBe(2);
    });

    it('korrigiert Beginn und Ende des heutigen Zeitraums; eine Überschneidung bleibt verboten', async () => {
      const renewal = await post<AdminLicenseBody>(platform, adminPath(companyA), {
        plan: 'ONE_YEAR',
      });
      const founding = renewal.periods[0]!;
      const corrected = await t
        .http()
        .put(adminPath(companyA))
        .set('Cookie', platform)
        .send({ validFrom: addCalendarDays(today, -30), validUntil: addCalendarDays(today, 10) })
        .expect(200);
      expect(corrected.body).toMatchObject({
        validFrom: addCalendarDays(today, -30),
        validUntil: addCalendarDays(today, 10),
        status: 'EXPIRING_SOON',
      });
      // Ins Folgejahr verlängert, überschnitte es die eingetragene Verlängerung.
      const overlap = await t
        .http()
        .put(adminPath(companyA))
        .set('Cookie', platform)
        .send({ periodId: founding.id, validUntil: renewal.periods[1]!.validFrom });
      expect(overlap.status).toBe(409);
      expect(overlap.body).toMatchObject({ code: 'LICENSE_PERIOD_OVERLAP' });
      const audit = await t.prisma.auditLog.findFirstOrThrow({
        where: { action: 'LICENSE_PERIOD_UPDATED' },
      });
      expect(audit.data).toEqual({
        validFrom: { from: today, to: addCalendarDays(today, -30) },
        validUntil: { from: founding.validUntil, to: addCalendarDays(today, 10) },
        notesChanged: false,
      });
    });

    it('setzt nach Ablauf einen neuen Zeitraum ab heute', async () => {
      await setPeriod(addCalendarDays(today, -40));
      expect((await license()).status).toBe('EXPIRED');
      const body = await post<AdminLicenseBody>(platform, adminPath(companyA), {
        plan: 'ONE_YEAR',
      });
      expect(body).toMatchObject({
        status: 'ACTIVE',
        plan: 'ONE_YEAR',
        validFrom: today,
        validUntil: defaultValidUntil('ONE_YEAR', today),
        busPackages: 1,
      });
    });
  });

  describe('Wirkung auf die Fahrtplanung', () => {
    it('kurz vor Ablauf und in der Kulanz warnt die Vorschau nur, die Veröffentlichung gelingt', async () => {
      await setPeriod(addCalendarDays(today, 3));
      expect(await preview()).toMatchObject({
        status: 'EXPIRING_VERY_SOON',
        planningAllowed: true,
        issue: null,
      });
      await schedule('schedule', plan()).expect(200);

      await setPeriod(addCalendarDays(today, -1));
      expect(await license()).toMatchObject({
        status: 'GRACE',
        daysUntilExpiry: -1,
        graceEndsOn: addCalendarDays(today, 13),
        planningAllowed: true,
      });
      expect(await preview(plan({ departureTime: '12:00' }))).toMatchObject({
        status: 'GRACE',
        issue: null,
      });
      await schedule('schedule', plan({ departureTime: '12:00' })).expect(200);

      // Tag 14 der Kulanz: noch erlaubt.
      await setPeriod(addCalendarDays(today, -14));
      await schedule('schedule', plan({ departureTime: '17:00' })).expect(200);
      expect(await t.prisma.trip.count()).toBe(3);
    });

    it('ab Tag 15 nach Ablauf lehnt die Veröffentlichung ab, auch ohne Bus; die Vorschau warnt', async () => {
      await setPeriod(addCalendarDays(today, -15));
      expect(await license()).toMatchObject({ status: 'EXPIRED', planningAllowed: false });
      expect(await preview()).toMatchObject({
        status: 'EXPIRED',
        planningAllowed: false,
        issue: 'LICENSE_EXPIRED',
      });
      const res = await schedule('schedule', plan());
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({
        code: 'LICENSE_EXPIRED',
        params: {
          validUntil: addCalendarDays(today, -15),
          graceEndsOn: addCalendarDays(today, -1),
        },
      });
      const layoutOnly = await schedule(
        'schedule',
        plan({ busId: undefined, seatLayoutId: layoutA }),
      );
      expect(layoutOnly.body).toMatchObject({ code: 'LICENSE_EXPIRED' });
      expect(await t.prisma.trip.count()).toBe(0);
    });

    it('die Ablaufgrenze liegt um Mitternacht in Damaskus, nicht in UTC', async () => {
      // Letzter Kulanztag ist heute + 2; die Uhr springt auf 23:59 Damaskus dieses Tages.
      const graceEnd = addCalendarDays(today, 2);
      await setPeriod(addCalendarDays(graceEnd, -14));
      const lastMinute = damascusDayRange(graceEnd).end.getTime() - 60_000;
      t.clock.advance(lastMinute - t.clock.now().getTime());
      // Die Sitzung läuft nach der Leerlaufzeit ab; neu anmelden mit der vorgestellten Uhr.
      t.resetRateLimits();
      adminA = await loginAs(t, 'admin@lizenz-a.example');
      const body = plan({ from: addCalendarDays(graceEnd, 1), to: addCalendarDays(graceEnd, 1) });
      expect(await preview(body)).toMatchObject({ status: 'GRACE', issue: null });
      await schedule('schedule', body).expect(200);

      // Zwei Minuten später ist in Damaskus der nächste Tag (21:01 UTC): abgelaufen.
      t.clock.advance(2 * 60_000);
      const next = plan({
        from: addCalendarDays(graceEnd, 1),
        to: addCalendarDays(graceEnd, 1),
        departureTime: '12:00',
      });
      expect(await preview(next)).toMatchObject({ status: 'EXPIRED', issue: 'LICENSE_EXPIRED' });
      expect((await schedule('schedule', next)).body).toMatchObject({ code: 'LICENSE_EXPIRED' });
      expect(await t.prisma.trip.count()).toBe(1);
    });

    it('Busgrenze: die jüngsten Busse über 5 je Paket planen nicht, die ältesten schon', async () => {
      const buses = [busA];
      for (let i = 0; i < 5; i++) {
        buses.push(await createBus());
      }
      expect(await license()).toMatchObject({ allowedBuses: 5, activeBuses: 6, busesOverLimit: 1 });
      const sixth = buses[5]!;
      expect(await preview(plan({ busId: sixth }))).toMatchObject({
        issue: 'LICENSE_BUS_LIMIT_EXCEEDED',
        busCovered: false,
        allowedBuses: 5,
        activeBuses: 6,
      });
      const rejected = await schedule('schedule', plan({ busId: sixth }));
      expect(rejected.status).toBe(403);
      expect(rejected.body).toMatchObject({
        code: 'LICENSE_BUS_LIMIT_EXCEEDED',
        params: { allowedBuses: 5, activeBuses: 6 },
      });
      // Der fünfte Bus und ein Plan nur mit Sitzplan sind abgedeckt.
      expect(await preview(plan({ busId: buses[4] }))).toMatchObject({ busCovered: true });
      await schedule('schedule', plan({ busId: buses[4] })).expect(200);
      await schedule('schedule', plan({ busId: undefined, seatLayoutId: layoutA })).expect(200);

      // Einen alten Bus deaktivieren: Der sechste rückt in die Abdeckung.
      await post(adminA, `${base(companyA)}/buses/${busA}/deactivate`, {}, 200);
      await schedule('schedule', plan({ busId: sixth, departureTime: '13:00' })).expect(200);
      // Wieder aktivieren und ein zweites Paket buchen: alle sechs abgedeckt.
      await post(adminA, `${base(companyA)}/buses/${busA}/activate`, {}, 200);
      expect(
        (await schedule('schedule', plan({ busId: sixth, departureTime: '18:00' }))).status,
      ).toBe(403);
      await t
        .http()
        .put(adminPath(companyA))
        .set('Cookie', platform)
        .send({ busPackages: 2 })
        .expect(200);
      await schedule('schedule', plan({ busId: sixth, departureTime: '18:00' })).expect(200);
    });
  });

  describe('Fahrgäste stranden nicht', () => {
    it('bei abgelaufener Lizenz laufen Suche, Buchung, Barbestätigung, Schalter, Storno und Absage weiter', async () => {
      // Die Test-Uhr steht nach dem Test zur Ablaufgrenze um Tage vor. Die Fahrt liegt deshalb
      // relativ zu ihr; mit echter Zeit läge der Verkaufsschluss in den ersten 30 Minuten nach
      // Mitternacht in Damaskus vor der Uhr (SALES_CLOSED).
      const bookable = await createBookableTrip(t.prisma, {
        trip: { departureAt: new Date(t.clock.now().getTime() + 3 * 24 * 3_600_000) },
      });
      const companyId = bookable.fixture.companyId;
      await setPeriod(addCalendarDays(today, -60), { companyId });
      await createStaff(t.prisma, {
        email: 'schalter@lizenz-c.example',
        password: PASSWORD,
        memberships: [{ companyId, role: 'ADMIN' }],
      });
      const staff = await loginAs(t, 'schalter@lizenz-c.example');
      expect((await license(companyId, staff)).status).toBe('EXPIRED');

      // Öffentlich: Sitzplan und Buchung.
      await t
        .http()
        .post(`/api/v1/trips/${bookable.trip.tripId}/seat-map`)
        .send({ fromStopId: bookable.trip.tripStopIds[0], toStopId: bookable.trip.tripStopIds[3] })
        .expect(200);
      const held = await hold(t, bookable, { passengers: [{ label: '1A', gender: 'FEMALE' }] });
      await guestPost(t, held, 'reserve-cash').expect(200);
      const confirmed = await t
        .http()
        .post(`${base(companyId)}/bookings/${held.id}/confirm-cash`)
        .set('Cookie', staff)
        .send({});
      expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
      expect(confirmed.body).toMatchObject({ status: 'CONFIRMED' });

      // Zweiter Gast storniert selbst.
      const second = await hold(t, bookable, { passengers: [{ label: '2A', gender: 'FEMALE' }] });
      await guestPost(t, second, 'cancel').expect(200);

      // Schalter verkauft und die Firma storniert.
      const sale = await t
        .http()
        .post(`${base(companyId)}/counter/sales`)
        .set('Cookie', staff)
        .set('Idempotency-Key', randomUUID())
        .send(bookingBody(bookable, { passengers: [{ label: '3A', gender: 'MALE' }] }));
      expect(sale.status, JSON.stringify(sale.body)).toBe(201);
      const saleId = (sale.body as { booking: { id: string } }).booking.id;
      const cancelled = await t
        .http()
        .post(`${base(companyId)}/bookings/${saleId}/cancel`)
        .set('Cookie', staff)
        .send({ reason: 'PASSENGER_REQUEST' });
      expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
      expect(cancelled.body).toMatchObject({ status: 'CANCELLED' });

      // Die Firma kann die Fahrt weiter absagen; die bestätigte Buchung wird storniert.
      const cancelTrip = await t
        .http()
        .post(`${base(companyId)}/trips/${bookable.trip.tripId}/cancel`)
        .set('Cookie', staff)
        .send({});
      expect(cancelTrip.status, JSON.stringify(cancelTrip.body)).toBe(200);
      expect(cancelTrip.body).toMatchObject({ cancelledBookings: 1 });
    });
  });

  describe('Nebenläufigkeit mit zwei echten Verbindungen', () => {
    it('eine laufende Lizenzänderung hält die Veröffentlichung auf; danach sieht sie den Ablauf', async () => {
      await raw.query('BEGIN');
      let res: Awaited<ReturnType<typeof schedule>>;
      try {
        await raw.query('SELECT id FROM company WHERE id = $1 FOR NO KEY UPDATE', [companyA]);
        const pending = schedule('schedule', plan()).then((response) => response);
        await waitUntilApiBlocked(observer, 1);
        await raw.query(
          `UPDATE company_license SET valid_from = $2::date - 200, valid_until = $2::date - 30
           WHERE company_id = $1`,
          [companyA, today],
        );
        await raw.query('COMMIT');
        res = await pending;
      } catch (error) {
        await raw.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: 'LICENSE_EXPIRED' });
      expect(await t.prisma.trip.count()).toBe(0);
    });

    it('eine laufende Veröffentlichung hält die Lizenzänderung auf; beide gelingen nacheinander', async () => {
      await setPeriod(addCalendarDays(today, 100));
      await raw.query('BEGIN');
      let results: Awaited<ReturnType<typeof schedule>>[];
      try {
        // Die Strecke ist gesperrt: Die Veröffentlichung hält schon die Firma (FOR SHARE) und
        // wartet auf die Strecke; die Änderung des Plattform-Admins wartet auf die Firma.
        await raw.query('SELECT id FROM route WHERE id = $1 FOR UPDATE', [routeA]);
        const publishing = schedule('schedule', plan()).then((response) => response);
        await waitUntilApiBlocked(observer, 1);
        const expiring = t
          .http()
          .put(adminPath(companyA))
          .set('Cookie', platform)
          .send({ validUntil: addCalendarDays(today, -30) })
          .then((response) => response);
        await waitUntilApiBlocked(observer, 2);
        await raw.query('COMMIT');
        results = await Promise.all([publishing, expiring]);
      } catch (error) {
        await raw.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
      expect(results.map((res) => res.status)).toEqual([200, 200]);
      expect(await t.prisma.trip.count()).toBe(1);
      expect((await license()).status).toBe('EXPIRED');
      // Ab jetzt lehnt die Planung ab.
      expect((await schedule('schedule', plan({ departureTime: '10:00' }))).status).toBe(403);
    });

    it('ein Bus, der während einer Veröffentlichung aktiviert wird, verschiebt die Abdeckung erst danach', async () => {
      const buses = [busA];
      for (let i = 0; i < 5; i++) {
        buses.push(await createBus());
      }
      await post(adminA, `${base(companyA)}/buses/${busA}/deactivate`, {}, 200);
      const sixth = buses[5]!;
      await raw.query('BEGIN');
      let results: Awaited<ReturnType<typeof schedule>>[];
      try {
        await raw.query('SELECT id FROM route WHERE id = $1 FOR UPDATE', [routeA]);
        const publishing = schedule('schedule', plan({ busId: sixth })).then(
          (response) => response,
        );
        await waitUntilApiBlocked(observer, 1);
        const activating = t
          .http()
          .post(`${base(companyA)}/buses/${busA}/activate`)
          .set('Cookie', adminA)
          .send({})
          .then((response) => response);
        await waitUntilApiBlocked(observer, 2);
        await raw.query('COMMIT');
        results = await Promise.all([publishing, activating]);
      } catch (error) {
        await raw.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
      expect(results.map((res) => res.status)).toEqual([200, 200]);
      expect(await t.prisma.trip.count({ where: { busId: sixth } })).toBe(1);
      const next = await schedule('schedule', plan({ busId: sixth, departureTime: '15:00' }));
      expect(next.body).toMatchObject({ code: 'LICENSE_BUS_LIMIT_EXCEEDED' });
    });
  });
});
