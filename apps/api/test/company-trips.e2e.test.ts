import { randomInt, randomUUID } from 'node:crypto';

import { localDateInDamascus } from '@masar/shared';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createCompany,
  createStaff,
  createTestApp,
  loginAs,
  PASSWORD,
  resetDatabase,
  type TestApp,
} from './helpers/app.js';
import { waitUntilApiBlocked } from './helpers/bookings.js';
import { connectRaw, randomBookingCode } from './helpers/inventory.js';

/**
 * Fahrtplanung gegen PostgreSQL (Schritt 2.4): Vorschau und Veröffentlichung eines Wochenplans
 * (Halte, Kontingent, Idempotenz, Ablehnungen), Liste und Einzelabruf, Absage mit Storno der
 * Buchungen, Kontingent ändern, Rollen, Mandantentrennung und Nebenläufigkeit mit echten
 * Verbindungen. Strecken, Sitzpläne und Busse entstehen über ihre eigene API.
 */

interface ScheduleItemBody {
  serviceDate: string;
  departureAt: string;
  arrivalAt: string;
  state: 'NEW' | 'EXISTS' | 'BUS_CONFLICT';
  tripId: string | null;
  fareMissing: boolean;
  stops: { seq: number; arrivalAt: string | null; departureAt: string | null }[];
}

interface ScheduleBody {
  busId: string | null;
  seatLayoutId: string;
  seatCount: number;
  onlineSeats: number;
  genderRuleEnabled: boolean;
  onlineSalesCloseMinutes: number;
  stopOffsetsMinutes: number[];
  items: ScheduleItemBody[];
  summary: {
    total: number;
    new: number;
    existing: number;
    busConflicts: number;
    fareMissingDates: string[];
  };
}

interface TripBody {
  id: string;
  status: string;
  serviceDate: string;
  departureAt: string;
  arrivalAt: string;
  onlineSalesCloseAt: string;
  genderRuleEnabled: boolean;
  route: { id: string };
  bus: { id: string; plate: string } | null;
  seatLayout: { id: string };
  quota: { total: number; online: number; counter: number; blocked: number; occupied: number };
  activeBookings: number;
  stops: {
    id: string;
    seq: number;
    arrivalAt: string | null;
    departureAt: string | null;
    station: { id: string };
    city: { id: string };
  }[];
  seats: {
    seatId: string;
    label: string;
    row: number;
    onlineSellable: boolean;
    occupied: boolean;
  }[];
}

const STANDARD_RULES = [
  { minMinutesBeforeDeparture: 1440, feeBps: 0 },
  { minMinutesBeforeDeparture: 0, feeBps: 5000 },
];

const DEMO_FARES = [
  { fromSeq: 0, toSeq: 1, amountMinor: 25_000 },
  { fromSeq: 0, toSeq: 2, amountMinor: 35_000 },
  { fromSeq: 0, toSeq: 3, amountMinor: 60_000 },
  { fromSeq: 1, toSeq: 2, amountMinor: 15_000 },
  { fromSeq: 1, toSeq: 3, amountMinor: 40_000 },
  { fromSeq: 2, toSeq: 3, amountMinor: 30_000 },
];

const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function weekdayOf(day: string): number {
  return new Date(`${day}T00:00:00.000Z`).getUTCDay();
}

function fieldPaths(res: { body: unknown }): string[] {
  return ((res.body as { errors?: { path: string }[] }).errors ?? []).map((error) => error.path);
}

describe('Fahrtplanung (Integration)', () => {
  let t: TestApp;
  let raw: pg.Client;
  let observer: pg.Client;
  let companyA: string;
  let companyB: string;
  let adminA: string;
  let agentA: string;
  let driverA: string;
  let adminB: string;
  let cities: string[];
  let stations: string[];
  let today: string;
  let tomorrow: string;
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
  const trips = (companyId: string): string => `${base(companyId)}/trips`;

  async function post<T>(cookie: string, path: string, body: object, status = 200): Promise<T> {
    const res = await t.http().post(path).set('Cookie', cookie).send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    return res.body as T;
  }

  async function createRoute(cookie: string, companyId: string, stops = stations): Promise<string> {
    const policy = await post<{ id: string }>(
      cookie,
      `${base(companyId)}/cancellation-policies`,
      { name: `Regel ${randomUUID().slice(0, 8)}`, rules: STANDARD_RULES },
      201,
    );
    const route = await post<{ id: string }>(
      cookie,
      `${base(companyId)}/routes`,
      {
        nameAr: 'دمشق – حلب',
        nameEn: `Damascus – Aleppo ${randomUUID().slice(0, 8)}`,
        cancellationPolicyId: policy.id,
        stops,
        fares: {
          currency: 'SYP',
          items: DEMO_FARES.filter((fare) => fare.toSeq < stops.length),
        },
      },
      201,
    );
    return route.id;
  }

  async function createLayout(cookie: string, companyId: string): Promise<string> {
    const layout = await post<{ id: string }>(
      cookie,
      `${base(companyId)}/seat-layouts`,
      {
        name: `Standard ${randomUUID().slice(0, 8)}`,
        pattern: 'TWO_PLUS_TWO',
        rows: 10,
        backBench: 5,
      },
      201,
    );
    return layout.id;
  }

  async function createBus(
    cookie: string,
    companyId: string,
    seatLayoutId: string,
  ): Promise<string> {
    const bus = await post<{ id: string }>(
      cookie,
      `${base(companyId)}/buses`,
      { plate: `BUS ${randomUUID().slice(0, 6)}`, seatLayoutId },
      201,
    );
    return bus.id;
  }

  function plan(overrides: object = {}): Record<string, unknown> {
    return {
      routeId: routeA,
      busId: busA,
      weekdays: ALL_WEEKDAYS,
      departureTime: '07:00',
      durationMinutes: 320,
      from: tomorrow,
      to: addDays(tomorrow, 6),
      ...overrides,
    };
  }

  async function publish(body: object = plan(), cookie = adminA, companyId = companyA) {
    return t
      .http()
      .post(`${trips(companyId)}/schedule`)
      .set('Cookie', cookie)
      .send(body);
  }

  async function published(body: object = plan()): Promise<ScheduleBody> {
    const res = await publish(body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as ScheduleBody;
  }

  async function trip(tripId: string, cookie = adminA): Promise<TripBody> {
    const res = await t
      .http()
      .get(`${trips(companyA)}/${tripId}`)
      .set('Cookie', cookie);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as TripBody;
  }

  /** Hält einen Sitz über die öffentliche Buchungs-API (Damaskus → Aleppo). */
  function hold(detail: TripBody, seatId: string) {
    return t
      .http()
      .post('/api/v1/bookings')
      .set('Idempotency-Key', randomUUID())
      .send({
        tripId: detail.id,
        fromStopId: detail.stops[0]!.id,
        toStopId: detail.stops.at(-1)!.id,
        locale: 'en',
        contact: { name: 'Lina Haddad', phone: `+9639331${String(randomInt(10_000, 100_000))}` },
        passengers: [{ seatId, fullName: 'Lina Haddad', gender: 'FEMALE' }],
      });
  }

  beforeEach(async () => {
    await resetDatabase();
    t.resetRateLimits();
    today = localDateInDamascus(t.clock.now());
    tomorrow = addDays(today, 1);
    companyA = (await createCompany(t.prisma, 'fahrten-a')).id;
    companyB = (await createCompany(t.prisma, 'fahrten-b')).id;
    const staff: [string, string, 'ADMIN' | 'AGENT' | 'DRIVER'][] = [
      ['admin@fahrten-a.example', companyA, 'ADMIN'],
      ['agent@fahrten-a.example', companyA, 'AGENT'],
      ['fahrer@fahrten-a.example', companyA, 'DRIVER'],
      ['admin@fahrten-b.example', companyB, 'ADMIN'],
    ];
    for (const [email, companyId, role] of staff) {
      await createStaff(t.prisma, {
        email,
        password: PASSWORD,
        memberships: [{ companyId, role }],
      });
    }
    adminA = await loginAs(t, 'admin@fahrten-a.example');
    agentA = await loginAs(t, 'agent@fahrten-a.example');
    driverA = await loginAs(t, 'fahrer@fahrten-a.example');
    adminB = await loginAs(t, 'admin@fahrten-b.example');

    cities = [];
    stations = [];
    for (const [slug, nameAr, nameEn] of [
      ['damascus', 'دمشق', 'Damascus'],
      ['homs', 'حمص', 'Homs'],
      ['hama', 'حماة', 'Hama'],
      ['aleppo', 'حلب', 'Aleppo'],
    ] as const) {
      const city = await t.prisma.city.create({ data: { slug, nameAr, nameEn } });
      const station = await t.prisma.station.create({
        data: { cityId: city.id, nameAr: `كراج ${nameAr}`, nameEn: `${nameEn} Terminal` },
      });
      cities.push(city.id);
      stations.push(station.id);
    }
    routeA = await createRoute(adminA, companyA);
    layoutA = await createLayout(adminA, companyA);
    busA = await createBus(adminA, companyA, layoutA);
  });

  describe('Vorschau', () => {
    it('zeigt Termine mit Halten und Kontingent und schreibt nichts', async () => {
      const preview = await post<ScheduleBody>(
        adminA,
        `${trips(companyA)}/schedule/preview`,
        plan(),
      );
      expect(preview.summary).toEqual({
        total: 7,
        new: 7,
        existing: 0,
        busConflicts: 0,
        fareMissingDates: [],
      });
      expect(preview).toMatchObject({
        busId: busA,
        seatLayoutId: layoutA,
        seatCount: 45,
        onlineSeats: 45,
        genderRuleEnabled: true,
        onlineSalesCloseMinutes: 30,
        stopOffsetsMinutes: [107, 213],
      });
      const first = preview.items[0]!;
      expect(first.serviceDate).toBe(tomorrow);
      expect(first.tripId).toBeNull();
      // 07:00 in Damaskus (UTC+3) ist 04:00 UTC; Ankunft 320 Minuten später.
      expect(first.departureAt).toBe(`${tomorrow}T04:00:00.000Z`);
      expect(first.arrivalAt).toBe(`${tomorrow}T09:20:00.000Z`);
      expect(first.stops.map((stop) => [stop.arrivalAt, stop.departureAt])).toEqual([
        [null, `${tomorrow}T04:00:00.000Z`],
        [`${tomorrow}T05:47:00.000Z`, `${tomorrow}T05:47:00.000Z`],
        [`${tomorrow}T07:33:00.000Z`, `${tomorrow}T07:33:00.000Z`],
        [`${tomorrow}T09:20:00.000Z`, null],
      ]);
      expect(await t.prisma.trip.count()).toBe(0);
    });

    it('warnt vor Tarif-Lücken und Busüberschneidungen, statt abzulehnen', async () => {
      await published(plan({ to: tomorrow }));
      await t.prisma.fare.updateMany({
        where: { routeId: routeA },
        data: { validUntil: new Date(`${addDays(tomorrow, 2)}T00:00:00.000Z`) },
      });
      const preview = await post<ScheduleBody>(
        adminA,
        `${trips(companyA)}/schedule/preview`,
        plan({ departureTime: '08:00', to: addDays(tomorrow, 3) }),
      );
      expect(preview.items.map((item) => [item.state, item.fareMissing])).toEqual([
        ['BUS_CONFLICT', false],
        ['NEW', false],
        ['NEW', true],
        ['NEW', true],
      ]);
      expect(preview.summary.fareMissingDates).toEqual([
        addDays(tomorrow, 2),
        addDays(tomorrow, 3),
      ]);
    });
  });

  describe('Veröffentlichen', () => {
    it('legt je Termin eine Fahrt mit Halten und Kontingent an, die in der Suche erscheint', async () => {
      const result = await published();
      expect(result.summary).toMatchObject({ total: 7, new: 7, existing: 0 });
      expect(result.items.every((item) => item.tripId !== null)).toBe(true);
      expect(await t.prisma.trip.count({ where: { companyId: companyA } })).toBe(7);
      expect(await t.prisma.tripStop.count()).toBe(28);
      expect(await t.prisma.tripSeat.count()).toBe(7 * 45);

      const detail = await trip(result.items[0]!.tripId!);
      expect(detail).toMatchObject({
        status: 'SCHEDULED',
        serviceDate: tomorrow,
        departureAt: `${tomorrow}T04:00:00.000Z`,
        onlineSalesCloseAt: `${tomorrow}T03:30:00.000Z`,
        genderRuleEnabled: true,
        route: { id: routeA },
        bus: { id: busA },
        seatLayout: { id: layoutA },
        quota: { total: 45, online: 45, counter: 0, blocked: 0, occupied: 0 },
        activeBookings: 0,
      });
      expect(detail.stops.map((stop) => stop.station.id)).toEqual(stations);

      const search = await t.http().get('/api/v1/trips/search').query({
        from: cities[0],
        to: cities[3],
        date: tomorrow,
      });
      expect(search.status).toBe(200);
      const items = (search.body as { items: { tripId: string; fare: { amountMinor: number } }[] })
        .items;
      expect(items.map((item) => item.tripId)).toEqual([detail.id]);
      expect(items[0]!.fare.amountMinor).toBe(60_000);
      // Teilstrecke über einen Zwischenhalt: Homs → Aleppo ab 05:47 UTC am selben Tag.
      const partial = await t.http().get('/api/v1/trips/search').query({
        from: cities[1],
        to: cities[3],
        date: tomorrow,
      });
      expect((partial.body as { items: unknown[] }).items).toHaveLength(1);
    });

    it('ist idempotent: ein zweiter Aufruf überspringt alle Termine', async () => {
      const first = await published();
      const second = await published();
      expect(second.summary).toMatchObject({ total: 7, new: 0, existing: 7 });
      expect(second.items.map((item) => item.tripId)).toEqual(
        first.items.map((item) => item.tripId),
      );
      expect(await t.prisma.trip.count()).toBe(7);
      // Ein längerer Zeitraum ergänzt nur die neuen Tage.
      const longer = await published(plan({ to: addDays(tomorrow, 9) }));
      expect(longer.summary).toMatchObject({ total: 10, new: 3, existing: 7 });
      expect(await t.prisma.trip.count()).toBe(10);
    });

    it('nimmt eigene Halt-Zeiten, Kontingent, Geschlechtsregel und Verkaufsschluss an', async () => {
      const result = await published(
        plan({
          busId: undefined,
          seatLayoutId: layoutA,
          weekdays: [weekdayOf(tomorrow)],
          departureTime: '23:00',
          stopOffsetsMinutes: [120, 190],
          onlineSeatCount: 36,
          genderRuleEnabled: false,
          onlineSalesCloseMinutes: 60,
        }),
      );
      expect(result.summary.new).toBe(1);
      const detail = await trip(result.items[0]!.tripId!);
      // 23:00 Ortszeit ist 20:00 UTC; Homs nach Mitternacht Ortszeit.
      expect(detail).toMatchObject({
        bus: null,
        genderRuleEnabled: false,
        departureAt: `${tomorrow}T20:00:00.000Z`,
        onlineSalesCloseAt: `${tomorrow}T19:00:00.000Z`,
        quota: { total: 45, online: 36, counter: 9, blocked: 0 },
      });
      expect(detail.stops[1]!.departureAt).toBe(`${tomorrow}T22:00:00.000Z`);
      // Die hinteren Sitze bleiben dem Schalter: die zehnte Reihe und die Hinterbank.
      const counterRows = new Set(detail.seats.filter((s) => !s.onlineSellable).map((s) => s.row));
      expect([...counterRows].sort((a, b) => a - b)).toEqual([9, 10]);
    });

    it('legt eine zweite Fahrt zur selben Zeit mit einem anderen Bus an', async () => {
      await published(plan({ to: tomorrow }));
      const other = await createBus(adminA, companyA, layoutA);
      const result = await published(plan({ busId: other, to: tomorrow }));
      expect(result.summary).toMatchObject({ new: 1, existing: 0 });
      expect(await t.prisma.trip.count()).toBe(2);
    });

    it('lehnt archivierte Strecken, archivierte Pläne und deaktivierte Busse ab', async () => {
      const otherRoute = await createRoute(adminA, companyA);
      await post(adminA, `${base(companyA)}/routes/${otherRoute}/archive`, {});
      const archived = await publish(plan({ routeId: otherRoute }));
      expect(archived.status).toBe(409);
      expect(archived.body).toMatchObject({ code: 'ROUTE_ARCHIVED' });

      const retiredLayout = await createLayout(adminA, companyA);
      const retiredBus = await createBus(adminA, companyA, retiredLayout);
      await post(adminA, `${base(companyA)}/seat-layouts/${retiredLayout}/archive`, {});
      for (const body of [
        plan({ busId: undefined, seatLayoutId: retiredLayout }),
        plan({ busId: retiredBus }),
      ]) {
        const res = await publish(body);
        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({ code: 'SEAT_LAYOUT_RETIRED' });
      }

      await post(adminA, `${base(companyA)}/buses/${busA}/deactivate`, {});
      const inactive = await publish();
      expect(inactive.status).toBe(409);
      expect(inactive.body).toMatchObject({ code: 'BUS_INACTIVE' });
      expect(await t.prisma.trip.count()).toBe(0);
    });

    it('lehnt eine Doppelbelegung des Busses ab, auch über Strecken und innerhalb des Plans', async () => {
      await published(plan({ to: tomorrow }));
      const otherRoute = await createRoute(adminA, companyA);
      const overlap = await publish(
        plan({ routeId: otherRoute, departureTime: '09:00', to: tomorrow }),
      );
      expect(overlap.status).toBe(409);
      expect(overlap.body).toMatchObject({
        code: 'BUS_DOUBLE_BOOKED',
        params: { departures: [`${tomorrow}T06:00:00.000Z`] },
      });
      // Ankunft 12:20 Ortszeit: eine Abfahrt um 12:20 ist erlaubt (halboffen).
      const after = await publish(
        plan({ routeId: otherRoute, departureTime: '12:20', to: tomorrow }),
      );
      expect(after.status).toBe(200);
      // 30 Stunden Fahrzeit an zwei aufeinanderfolgenden Tagen überschneiden sich selbst.
      const selfOverlap = await publish(
        plan({ from: addDays(tomorrow, 3), to: addDays(tomorrow, 4), durationMinutes: 1800 }),
      );
      expect(selfOverlap.status).toBe(409);
      expect(selfOverlap.body).toMatchObject({ code: 'BUS_DOUBLE_BOOKED' });
      expect(await t.prisma.trip.count()).toBe(2);
    });

    it('lehnt Fahrtage ohne vollständigen Tarif ab', async () => {
      await t.prisma.fare.updateMany({
        where: { routeId: routeA },
        data: { validUntil: new Date(`${addDays(tomorrow, 3)}T00:00:00.000Z`) },
      });
      const res = await publish();
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        code: 'FARE_MISSING_FOR_DATE',
        params: { dates: [3, 4, 5, 6].map((days) => addDays(tomorrow, days)) },
      });
      expect(await t.prisma.trip.count()).toBe(0);
      expect((await publish(plan({ to: addDays(tomorrow, 2) }))).status).toBe(200);
    });

    it('lehnt Vergangenheit, falsche Halt-Zeiten, zu großes Kontingent und ungültige Eingaben ab', async () => {
      const past = await publish(plan({ from: today, departureTime: '00:00', to: today }));
      expect(past.status).toBe(400);
      expect(past.body).toMatchObject({ code: 'TRIP_SCHEDULE_IN_PAST' });
      const yesterday = await publish(plan({ from: addDays(today, -1) }));
      expect(yesterday.body).toMatchObject({ code: 'TRIP_SCHEDULE_IN_PAST' });

      for (const offsets of [[100], [200, 100], [100, 320]]) {
        const res = await publish(plan({ stopOffsetsMinutes: offsets }));
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({
          code: 'TRIP_STOP_OFFSETS_INVALID',
          params: { intermediateStops: 2 },
        });
      }

      const quota = await publish(plan({ onlineSeatCount: 46 }));
      expect(quota.status).toBe(400);
      expect(quota.body).toMatchObject({ code: 'TRIP_QUOTA_INVALID', params: { max: 45 } });

      const both = await publish(plan({ seatLayoutId: layoutA }));
      expect(both.body).toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(fieldPaths(both)).toContain('busId');
      const tooLong = await publish(plan({ to: addDays(tomorrow, 62) }));
      expect(fieldPaths(tooLong)).toContain('to');
      const badTime = await publish(plan({ departureTime: '24:00', weekdays: [1, 1] }));
      expect(fieldPaths(badTime)).toEqual(expect.arrayContaining(['departureTime', 'weekdays']));
      expect(await t.prisma.trip.count()).toBe(0);
    });
  });

  describe('Liste und Einzelabruf', () => {
    it('filtert nach Zeitraum, Strecke und Status und blättert mit Cursor', async () => {
      await published();
      const otherRoute = await createRoute(adminA, companyA);
      const other = await published(plan({ routeId: otherRoute, departureTime: '15:00' }));
      await post(adminA, `${trips(companyA)}/${other.items[0]!.tripId}/cancel`, {});

      const all = await t
        .http()
        .get(trips(companyA))
        .query({ from: tomorrow, to: addDays(tomorrow, 6) })
        .set('Cookie', adminA);
      expect(all.status).toBe(200);
      const items = (all.body as { items: TripBody[] }).items;
      expect(items).toHaveLength(14);
      expect(items.map((item) => item.departureAt)).toEqual(
        [...items.map((item) => item.departureAt)].sort(),
      );

      const byRoute = await t
        .http()
        .get(trips(companyA))
        .query({ routeId: otherRoute, status: 'CANCELLED' })
        .set('Cookie', adminA);
      expect((byRoute.body as { items: TripBody[] }).items.map((item) => item.id)).toEqual([
        other.items[0]!.tripId,
      ]);

      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const query: Record<string, string> = {
          from: tomorrow,
          to: addDays(tomorrow, 6),
          limit: '5',
        };
        if (cursor !== null) query.cursor = cursor;
        const page = await t.http().get(trips(companyA)).query(query).set('Cookie', driverA);
        expect(page.status).toBe(200);
        const body = page.body as { items: TripBody[]; nextCursor: string | null };
        seen.push(...body.items.map((item) => item.id));
        cursor = body.nextCursor;
      } while (cursor !== null);
      expect(seen).toEqual(items.map((item) => item.id));

      const day = await t
        .http()
        .get(trips(companyA))
        .query({ from: addDays(tomorrow, 2), to: addDays(tomorrow, 2) })
        .set('Cookie', agentA);
      expect((day.body as { items: unknown[] }).items).toHaveLength(2);

      const badCursor = await t
        .http()
        .get(trips(companyA))
        .query({ cursor: 'kaputt!' })
        .set('Cookie', adminA);
      expect(badCursor.status).toBe(400);
    });
  });

  describe('Abgelaufene, noch nicht freigegebene Buchungen', () => {
    it('zählen in Liste und Einzelabruf weder als belegt noch als aktiv', async () => {
      const result = await published(plan({ to: tomorrow }));
      const tripId = result.items[0]!.tripId!;
      const detail = await trip(tripId);
      const seat = detail.seats[0]!;
      const booked = await hold(detail, seat.seatId);
      expect(booked.status, JSON.stringify(booked.body)).toBe(201);
      const bookingId = (booked.body as { booking: { id: string } }).booking.id;
      const held = await trip(tripId);
      expect(held).toMatchObject({ activeBookings: 1, quota: { occupied: 1 } });
      expect(held.seats.find((s) => s.seatId === seat.seatId)?.occupied).toBe(true);

      // Frist abgelaufen, der Ablauf-Job ist noch nicht gelaufen: Die Belegung steht noch.
      await t.prisma.booking.update({
        where: { id: bookingId },
        data: { holdExpiresAt: new Date(t.clock.now().getTime() - 60_000) },
      });
      const expired = await trip(tripId);
      expect(expired).toMatchObject({ activeBookings: 0, quota: { occupied: 0 } });
      expect(expired.seats.find((s) => s.seatId === seat.seatId)?.occupied).toBe(false);
      const list = await t
        .http()
        .get(trips(companyA))
        .query({ from: tomorrow, to: tomorrow })
        .set('Cookie', adminA);
      expect((list.body as { items: TripBody[] }).items).toMatchObject([
        { id: tripId, activeBookings: 0, quota: { occupied: 0 } },
      ]);
      expect(await t.prisma.seatOccupation.count({ where: { tripId } })).toBe(1);
    });
  });

  describe('Absagen', () => {
    it('storniert aktive Buchungen, nimmt die Fahrt aus dem Verkauf und ist wiederholbar', async () => {
      const result = await published(plan({ to: tomorrow }));
      const tripId = result.items[0]!.tripId!;
      const detail = await trip(tripId);
      const booked = await hold(detail, detail.seats[0]!.seatId);
      expect(booked.status, JSON.stringify(booked.body)).toBe(201);
      const bookingId = (booked.body as { booking: { id: string } }).booking.id;
      expect((await trip(tripId)).quota.occupied).toBe(1);

      const cancelled = await post<{ trip: TripBody; cancelledBookings: number }>(
        adminA,
        `${trips(companyA)}/${tripId}/cancel`,
        {},
      );
      expect(cancelled.cancelledBookings).toBe(1);
      expect(cancelled.trip).toMatchObject({ status: 'CANCELLED', activeBookings: 0 });
      expect(cancelled.trip.quota.occupied).toBe(0);
      const booking = await t.prisma.booking.findUniqueOrThrow({
        where: { id: bookingId },
        select: { status: true, cancelledBy: true, cancelReason: true },
      });
      expect(booking).toEqual({
        status: 'CANCELLED',
        cancelledBy: 'COMPANY',
        cancelReason: 'TRIP_CANCELLED',
      });
      expect(await t.prisma.seatOccupation.count({ where: { tripId } })).toBe(0);
      expect(await t.prisma.outbox.count({ where: { type: 'BOOKING_CANCELLED' } })).toBe(1);
      expect(
        await t.prisma.auditLog.count({ where: { action: 'TRIP_CANCELLED', entityId: tripId } }),
      ).toBe(1);

      const again = await post<{ cancelledBookings: number }>(
        adminA,
        `${trips(companyA)}/${tripId}/cancel`,
        {},
      );
      expect(again.cancelledBookings).toBe(0);

      const late = await hold(detail, detail.seats[1]!.seatId);
      expect(late.status).toBe(409);
      expect(late.body).toMatchObject({ code: 'TRIP_NOT_BOOKABLE' });
      const search = await t
        .http()
        .get('/api/v1/trips/search')
        .query({ from: cities[0], to: cities[3], date: tomorrow });
      expect((search.body as { items: unknown[] }).items).toHaveLength(0);

      // Ein erneutes Veröffentlichen holt die abgesagte Fahrt nicht zurück.
      const republished = await published(plan({ to: tomorrow }));
      expect(republished.items[0]).toMatchObject({ state: 'EXISTS', tripId });
    });

    it('lehnt abgefahrene Fahrten ab', async () => {
      const result = await published(plan({ to: tomorrow }));
      const tripId = result.items[0]!.tripId!;
      await t.prisma.trip.update({ where: { id: tripId }, data: { status: 'DEPARTED' } });
      const res = await t
        .http()
        .post(`${trips(companyA)}/${tripId}/cancel`)
        .set('Cookie', adminA)
        .send({});
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
    });
  });

  describe('Kontingent ändern', () => {
    it('verschiebt freie Sitze zwischen online und Schalter, belegte nicht', async () => {
      const result = await published(plan({ to: tomorrow }));
      const tripId = result.items[0]!.tripId!;
      const detail = await trip(tripId);
      const [first, second, third] = detail.seats as [
        TripBody['seats'][number],
        TripBody['seats'][number],
        TripBody['seats'][number],
      ];
      expect((await hold(detail, first.seatId)).status).toBe(201);

      const quota = (body: object) =>
        t
          .http()
          .put(`${trips(companyA)}/${tripId}/quota`)
          .set('Cookie', adminA)
          .send(body);

      const occupied = await quota({ seats: [{ seatId: first.seatId, onlineSellable: false }] });
      expect(occupied.status).toBe(409);
      expect(occupied.body).toMatchObject({
        code: 'TRIP_SEAT_OCCUPIED',
        params: { seats: [first.label] },
      });

      const unknown = await quota({ seats: [{ seatId: randomUUID(), onlineSellable: false }] });
      expect(unknown.status).toBe(400);
      expect(unknown.body).toMatchObject({ code: 'SEAT_UNKNOWN' });

      const changed = await quota({
        seats: [
          { seatId: second.seatId, onlineSellable: false },
          // Unverändert: ein belegter Sitz, der online bleibt, stört nicht.
          { seatId: first.seatId, onlineSellable: true },
        ],
      });
      expect(changed.status, JSON.stringify(changed.body)).toBe(200);
      expect((changed.body as TripBody).quota).toMatchObject({
        online: 44,
        counter: 1,
        occupied: 1,
      });

      const blocked = await hold(detail, second.seatId);
      expect(blocked.status).toBe(409);
      expect(blocked.body).toMatchObject({ code: 'SEAT_NOT_ONLINE' });
      expect((await hold(detail, third.seatId)).status).toBe(201);

      const back = await quota({ seats: [{ seatId: second.seatId, onlineSellable: true }] });
      expect((back.body as TripBody).quota.online).toBe(45);
      expect(
        await t.prisma.auditLog.count({
          where: { action: 'TRIP_QUOTA_CHANGED', entityId: tripId },
        }),
      ).toBe(2);

      await post(adminA, `${trips(companyA)}/${tripId}/cancel`, {});
      const closed = await quota({ seats: [{ seatId: third.seatId, onlineSellable: false }] });
      expect(closed.status).toBe(409);
      expect(closed.body).toMatchObject({ code: 'TRIP_NOT_BOOKABLE' });
    });
  });

  describe('Rollen', () => {
    it('lässt alle Rollen lesen, aber nur Admins planen, absagen und das Kontingent ändern', async () => {
      const result = await published(plan({ to: tomorrow }));
      const tripId = result.items[0]!.tripId!;
      for (const cookie of [agentA, driverA]) {
        expect((await t.http().get(trips(companyA)).set('Cookie', cookie)).status).toBe(200);
        expect(
          (
            await t
              .http()
              .get(`${trips(companyA)}/${tripId}`)
              .set('Cookie', cookie)
          ).status,
        ).toBe(200);
        const writes = [
          t
            .http()
            .post(`${trips(companyA)}/schedule/preview`)
            .set('Cookie', cookie)
            .send(plan()),
          t
            .http()
            .post(`${trips(companyA)}/schedule`)
            .set('Cookie', cookie)
            .send(plan()),
          t
            .http()
            .post(`${trips(companyA)}/${tripId}/cancel`)
            .set('Cookie', cookie)
            .send({}),
          t
            .http()
            .put(`${trips(companyA)}/${tripId}/quota`)
            .set('Cookie', cookie)
            .send({ seats: [{ seatId: randomUUID(), onlineSellable: false }] }),
        ];
        for (const res of await Promise.all(writes)) {
          expect(res.status).toBe(403);
          expect(res.body).toMatchObject({ code: 'FORBIDDEN' });
        }
      }
      expect((await t.http().get(trips(companyA))).status).toBe(401);
      expect((await trip(tripId)).status).toBe('SCHEDULED');
    });
  });

  describe('Mandantentrennung', () => {
    it('trennt Fahrten, Strecken, Busse und Sitzpläne der Firmen in beide Richtungen', async () => {
      const result = await published(plan({ to: tomorrow }));
      const tripId = result.items[0]!.tripId!;

      // Fremde Firma im Pfad: kein Zugang.
      expect((await t.http().get(trips(companyA)).set('Cookie', adminB)).status).toBe(403);
      expect((await publish(plan(), adminB, companyA)).status).toBe(403);

      // Fahrt der Firma A unter dem Pfad der Firma B: unbekannt.
      for (const res of [
        await t
          .http()
          .get(`${trips(companyB)}/${tripId}`)
          .set('Cookie', adminB),
        await t
          .http()
          .post(`${trips(companyB)}/${tripId}/cancel`)
          .set('Cookie', adminB)
          .send({}),
        await t
          .http()
          .put(`${trips(companyB)}/${tripId}/quota`)
          .set('Cookie', adminB)
          .send({ seats: [{ seatId: randomUUID(), onlineSellable: false }] }),
      ]) {
        expect(res.status).toBe(404);
        expect(res.body).toMatchObject({ code: 'TRIP_NOT_FOUND' });
      }
      const listB = await t
        .http()
        .get(trips(companyB))
        .query({ from: tomorrow })
        .set('Cookie', adminB);
      expect((listB.body as { items: unknown[] }).items).toHaveLength(0);

      // Strecke, Bus und Sitzplan der Firma A im Plan der Firma B: unbekannt.
      const routeB = await createRoute(adminB, companyB);
      const layoutB = await createLayout(adminB, companyB);
      const busB = await createBus(adminB, companyB, layoutB);
      const cases: [object, string][] = [
        [plan({ busId: busB }), 'ROUTE_NOT_FOUND'],
        [plan({ routeId: routeB, busId: busA }), 'BUS_NOT_FOUND'],
        [
          plan({ routeId: routeB, busId: undefined, seatLayoutId: layoutA }),
          'SEAT_LAYOUT_NOT_FOUND',
        ],
      ];
      for (const [body, code] of cases) {
        const res = await publish(body, adminB, companyB);
        expect(res.status).toBe(404);
        expect(res.body).toMatchObject({ code });
      }
      // Firma B plant mit eigenen Daten zur selben Zeit; Firma A bleibt unberührt.
      const own = await publish(
        plan({ routeId: routeB, busId: busB, to: tomorrow }),
        adminB,
        companyB,
      );
      expect(own.status).toBe(200);
      expect(await t.prisma.trip.count({ where: { companyId: companyA } })).toBe(1);
      expect(await t.prisma.trip.count({ where: { companyId: companyB } })).toBe(1);
    });
  });

  describe('Nebenläufigkeit', () => {
    it('zwei gleichzeitige Veröffentlichungen desselben Plans legen keine Fahrt doppelt an', async () => {
      // Die Strecke ist gesperrt wie von einer laufenden Veröffentlichung; beide Aufrufe warten.
      await raw.query('BEGIN');
      let results: Awaited<ReturnType<typeof publish>>[];
      try {
        await raw.query('SELECT id FROM route WHERE id = $1 FOR UPDATE', [routeA]);
        const pending = Promise.all(
          [publish(), publish()].map((request) => request.then((res) => res)),
        );
        await waitUntilApiBlocked(observer, 2);
        await raw.query('COMMIT');
        results = await pending;
      } catch (error) {
        await raw.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
      const bodies = results.map((res) => {
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        return (res.body as ScheduleBody).summary;
      });
      expect(bodies.map((summary) => summary.new).sort()).toEqual([0, 7]);
      expect(bodies.map((summary) => summary.existing).sort()).toEqual([0, 7]);
      expect(await t.prisma.trip.count()).toBe(7);
      expect(await t.prisma.tripSeat.count()).toBe(7 * 45);
    });

    it('derselbe Bus auf zwei Strecken zur selben Zeit: genau eine Veröffentlichung gewinnt', async () => {
      const otherRoute = await createRoute(adminA, companyA);
      await raw.query('BEGIN');
      let results: Awaited<ReturnType<typeof publish>>[];
      try {
        await raw.query('SELECT id FROM bus WHERE id = $1 FOR UPDATE', [busA]);
        const pending = Promise.all(
          [
            publish(plan({ to: tomorrow })),
            publish(plan({ routeId: otherRoute, to: tomorrow })),
          ].map((request) => request.then((res) => res)),
        );
        await waitUntilApiBlocked(observer, 2);
        await raw.query('COMMIT');
        results = await pending;
      } catch (error) {
        await raw.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
      expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
      expect(results.find((res) => res.status === 409)?.body).toMatchObject({
        code: 'BUS_DOUBLE_BOOKED',
      });
      expect(await t.prisma.trip.count({ where: { busId: busA } })).toBe(1);
    });

    it('eine gleichzeitig geschriebene Buchung wird von der Absage mit storniert', async () => {
      const result = await published(plan({ to: tomorrow }));
      const tripId = result.items[0]!.tripId!;
      const detail = await trip(tripId);
      const seat = detail.seats[0]!;

      // Eigene Verbindung bucht wie der Buchungsservice unter der Trip-Sperre und hält die
      // Transaktion offen. Die Absage wartet auf die Sperre und sieht danach die Buchung.
      await raw.query('BEGIN');
      let res: Awaited<ReturnType<typeof publish>>;
      let bookingId: string;
      try {
        await raw.query('SELECT id FROM trip WHERE id = $1 FOR UPDATE', [tripId]);
        const booking = await raw.query<{ id: string }>(
          `INSERT INTO booking
             (company_id, trip_id, booking_code, status, channel, from_trip_stop_id,
              to_trip_stop_id, from_seq, to_seq, contact_name, contact_phone_e164,
              hold_expires_at, fare_amount_minor, total_amount_minor, currency, updated_at)
           VALUES ($1, $2, $3, 'HELD', 'ONLINE', $4, $5, 0, 3, 'Test Passenger', '+963900000000',
                   now() + interval '15 minutes', 60000, 60000, 'SYP', now())
           RETURNING id`,
          [companyA, tripId, randomBookingCode(), detail.stops[0]!.id, detail.stops[3]!.id],
        );
        bookingId = booking.rows[0]!.id;
        const passenger = await raw.query<{ id: string }>(
          `INSERT INTO booking_passenger (booking_id, trip_id, seat_id, full_name, gender, updated_at)
           VALUES ($1, $2, $3, 'Test Passenger', 'FEMALE', now()) RETURNING id`,
          [bookingId, tripId, seat.seatId],
        );
        await raw.query(
          `INSERT INTO seat_occupation
             (trip_id, seat_id, from_seq, to_seq, booking_id, booking_passenger_id, gender, updated_at)
           VALUES ($1, $2, 0, 3, $3, $4, 'FEMALE', now())`,
          [tripId, seat.seatId, bookingId, passenger.rows[0]!.id],
        );
        const pending = t
          .http()
          .post(`${trips(companyA)}/${tripId}/cancel`)
          .set('Cookie', adminA)
          .send({})
          .then((response) => response);
        await waitUntilApiBlocked(observer, 1);
        await raw.query('COMMIT');
        res = await pending;
      } catch (error) {
        await raw.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toMatchObject({ cancelledBookings: 1, trip: { status: 'CANCELLED' } });
      const stored = await t.prisma.booking.findUniqueOrThrow({
        where: { id: bookingId },
        select: { status: true },
      });
      expect(stored.status).toBe('CANCELLED');
      expect(await t.prisma.seatOccupation.count({ where: { tripId } })).toBe(0);
    });

    it('eine Buchung, die auf die Sperre der Absage wartet, scheitert danach', async () => {
      const result = await published(plan({ to: tomorrow }));
      const tripId = result.items[0]!.tripId!;
      const detail = await trip(tripId);

      // Die eigene Verbindung sagt ab wie der Service (Sperre, Status) und hält die Transaktion.
      await raw.query('BEGIN');
      let res: Awaited<ReturnType<typeof hold>>;
      try {
        await raw.query('SELECT id FROM trip WHERE id = $1 FOR UPDATE', [tripId]);
        const pending = hold(detail, detail.seats[0]!.seatId).then((response) => response);
        await waitUntilApiBlocked(observer, 1);
        await raw.query(`UPDATE trip SET status = 'CANCELLED', updated_at = now() WHERE id = $1`, [
          tripId,
        ]);
        await raw.query('COMMIT');
        res = await pending;
      } catch (error) {
        await raw.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'TRIP_NOT_BOOKABLE' });
      expect(await t.prisma.booking.count({ where: { tripId } })).toBe(0);
    });
  });
});
