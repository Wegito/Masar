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
import { insertTrip } from './helpers/fleet.js';
import { connectRaw } from './helpers/inventory.js';

/**
 * Strecken, Haltestellen, Tarife und Stornoregeln gegen PostgreSQL (Schritt 2.3): Katalog,
 * Tarifmatrix, Regel „eine genutzte Strecke behält Halte und Stornoregel", Tarifstände ab einem
 * Tag, Rollen, Mandantentrennung und Nebenläufigkeit mit zwei echten Verbindungen.
 */

interface FareSetBody {
  validFrom: string;
  validUntil: string | null;
  currency: string;
  items: { fromSeq: number; toSeq: number; amountMinor: number }[];
}

interface RouteBody {
  id: string;
  nameAr: string;
  nameEn: string;
  status: string;
  editable: boolean;
  tripCount: number;
  cancellationPolicy: { id: string; name: string };
  stops: { id: string; seq: number; station: { id: string }; city: { id: string } }[];
  fareSets: FareSetBody[];
}

interface PolicyBody {
  id: string;
  name: string;
  allowPassengerCancel: boolean;
  rules: { minMinutesBeforeDeparture: number; feeBps: number }[];
  routeCount: number;
}

const STANDARD_RULES = [
  { minMinutesBeforeDeparture: 1440, feeBps: 0 },
  { minMinutesBeforeDeparture: 120, feeBps: 2500 },
  { minMinutesBeforeDeparture: 0, feeBps: 5000 },
];

/** Demo-Tarife Damaskus–Homs–Hama–Aleppo in Minor-Units (monoton). */
const DEMO_FARES = [
  { fromSeq: 0, toSeq: 1, amountMinor: 25_000 },
  { fromSeq: 0, toSeq: 2, amountMinor: 35_000 },
  { fromSeq: 0, toSeq: 3, amountMinor: 60_000 },
  { fromSeq: 1, toSeq: 2, amountMinor: 15_000 },
  { fromSeq: 1, toSeq: 3, amountMinor: 40_000 },
  { fromSeq: 2, toSeq: 3, amountMinor: 30_000 },
];

function items<T = unknown>(res: { body: unknown }): T[] {
  return (res.body as { items: T[] }).items;
}

function fieldPaths(res: { body: unknown }): string[] {
  return ((res.body as { errors?: { path: string }[] }).errors ?? []).map((error) => error.path);
}

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

describe('Strecken, Haltestellen und Tarife (Integration)', () => {
  let t: TestApp;
  let raw: pg.Client;
  let observer: pg.Client;
  let companyA: string;
  let companyB: string;
  let adminA: string;
  let agentA: string;
  let driverA: string;
  let adminB: string;
  /** Öffentliche Haltestellen in Damaskus, Homs, Hama, Aleppo. */
  let stations: string[];
  let cities: string[];
  let policyA: string;
  let today: string;

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

  beforeEach(async () => {
    await resetDatabase();
    t.resetRateLimits();
    today = localDateInDamascus(t.clock.now());
    companyA = (await createCompany(t.prisma, 'strecken-a')).id;
    companyB = (await createCompany(t.prisma, 'strecken-b')).id;
    const staff: [string, string, 'ADMIN' | 'AGENT' | 'DRIVER'][] = [
      ['admin@strecken-a.example', companyA, 'ADMIN'],
      ['agent@strecken-a.example', companyA, 'AGENT'],
      ['fahrer@strecken-a.example', companyA, 'DRIVER'],
      ['admin@strecken-b.example', companyB, 'ADMIN'],
    ];
    for (const [email, companyId, role] of staff) {
      await createStaff(t.prisma, {
        email,
        password: PASSWORD,
        memberships: [{ companyId, role }],
      });
    }
    adminA = await loginAs(t, 'admin@strecken-a.example');
    agentA = await loginAs(t, 'agent@strecken-a.example');
    driverA = await loginAs(t, 'fahrer@strecken-a.example');
    adminB = await loginAs(t, 'admin@strecken-b.example');

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
    policyA = (await createPolicy(adminA, companyA)).id;
  });

  const base = (companyId: string): string => `/api/v1/companies/${companyId}`;
  const routes = (companyId: string): string => `${base(companyId)}/routes`;

  async function createPolicy(
    cookie: string,
    companyId: string,
    body: object = { name: 'Standard', rules: STANDARD_RULES },
  ): Promise<PolicyBody> {
    const res = await t
      .http()
      .post(`${base(companyId)}/cancellation-policies`)
      .set('Cookie', cookie)
      .send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as PolicyBody;
  }

  function routeBody(overrides: object = {}): object {
    return {
      nameAr: 'دمشق – حلب',
      nameEn: 'Damascus – Aleppo',
      cancellationPolicyId: policyA,
      stops: stations,
      fares: { currency: 'SYP', items: DEMO_FARES },
      ...overrides,
    };
  }

  async function createRoute(
    cookie = adminA,
    companyId = companyA,
    body: object = routeBody(),
  ): Promise<RouteBody> {
    const res = await t.http().post(routes(companyId)).set('Cookie', cookie).send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as RouteBody;
  }

  /** Fahrt per SQL auf der Strecke, wie sie die Fahrtplanung (2.4) anlegen wird. */
  async function layoutFor(companyId: string): Promise<string> {
    const layout = await t.prisma.seatLayout.create({
      data: { companyId, name: `Plan ${Math.random()}`, pattern: 'TWO_PLUS_TWO', status: 'ACTIVE' },
      select: { id: true },
    });
    return layout.id;
  }

  describe('Haltestellen-Katalog', () => {
    it('zeigt alle Städte mit öffentlichen und eigenen, nicht aber fremden Haltestellen', async () => {
      const own = await t
        .http()
        .post(`${base(companyA)}/stations`)
        .set('Cookie', adminA)
        .send({ cityId: cities[0], nameAr: '  مكتب   الشركة ', nameEn: 'Company office' })
        .expect(201);
      expect(own.body).toMatchObject({ nameAr: 'مكتب الشركة', own: true, cityId: cities[0] });
      await t
        .http()
        .post(`${base(companyB)}/stations`)
        .set('Cookie', adminB)
        .send({ cityId: cities[0], nameAr: 'مكتب ب', nameEn: 'Office B' })
        .expect(201);

      const res = await t
        .http()
        .get(`${base(companyA)}/stations`)
        .set('Cookie', driverA)
        .expect(200);
      const list = items<{ nameEn: string; stations: { nameEn: string; own: boolean }[] }>(res);
      expect(list.map((city) => city.nameEn)).toEqual(['Aleppo', 'Damascus', 'Hama', 'Homs']);
      const damascus = list.find((city) => city.nameEn === 'Damascus');
      expect(damascus?.stations).toEqual([
        expect.objectContaining({ nameEn: 'Company office', own: true }),
        expect.objectContaining({ nameEn: 'Damascus Terminal', own: false }),
      ]);

      const audit = await t.prisma.auditLog.findMany({
        where: { action: 'STATION_CREATED', companyId: companyA },
        select: { entityId: true, data: true },
      });
      expect(audit).toEqual([
        { entityId: (own.body as { id: string }).id, data: { cityId: cities[0] } },
      ]);
    });

    it('lehnt eine unbekannte Stadt und Nicht-Admins ab', async () => {
      const unknown = await t
        .http()
        .post(`${base(companyA)}/stations`)
        .set('Cookie', adminA)
        .send({ cityId: '0199f7a4-5c2e-7d3a-9b1e-2f4c6a8d0e12', nameAr: 'س', nameEn: 'X' })
        .expect(404);
      expect(unknown.body).toMatchObject({ code: 'CITY_NOT_FOUND' });
      await t
        .http()
        .post(`${base(companyA)}/stations`)
        .set('Cookie', agentA)
        .send({ cityId: cities[0], nameAr: 'س', nameEn: 'X' })
        .expect(403);
    });
  });

  describe('Stornoregeln', () => {
    it('legt eine Regel mit Stufen an und liest sie, größte Schwelle zuerst', async () => {
      const res = await t
        .http()
        .get(`${base(companyA)}/cancellation-policies/${policyA}`)
        .set('Cookie', agentA)
        .expect(200);
      expect(res.body).toMatchObject({
        name: 'Standard',
        allowPassengerCancel: true,
        rules: STANDARD_RULES,
        routeCount: 0,
      });
      const list = await t
        .http()
        .get(`${base(companyA)}/cancellation-policies`)
        .set('Cookie', driverA)
        .expect(200);
      expect(items<{ id: string }>(list).map((policy) => policy.id)).toEqual([policyA]);
      expect(
        await t.prisma.auditLog.count({ where: { action: 'CANCELLATION_POLICY_CREATED' } }),
      ).toBe(1);
    });

    it('lehnt doppelte Schwellen, sinkende Gebühren und Werte außerhalb der Grenzen ab', async () => {
      for (const rules of [
        [
          { minMinutesBeforeDeparture: 60, feeBps: 0 },
          { minMinutesBeforeDeparture: 60, feeBps: 100 },
        ],
        [
          { minMinutesBeforeDeparture: 1440, feeBps: 5000 },
          { minMinutesBeforeDeparture: 0, feeBps: 0 },
        ],
      ]) {
        const res = await t
          .http()
          .post(`${base(companyA)}/cancellation-policies`)
          .set('Cookie', adminA)
          .send({ name: 'X', rules })
          .expect(400);
        expect(res.body).toMatchObject({ code: 'CANCELLATION_RULES_INVALID' });
      }
      const range = await t
        .http()
        .post(`${base(companyA)}/cancellation-policies`)
        .set('Cookie', adminA)
        .send({ name: 'X', rules: [{ minMinutesBeforeDeparture: 0, feeBps: 10_001 }] })
        .expect(400);
      expect(fieldPaths(range)).toContain('rules.0.feeBps');
    });
  });

  describe('Strecken anlegen', () => {
    it('legt Halte in Reihenfolge und eine vollständige Tarifmatrix ab heute an', async () => {
      const route = await createRoute();
      expect(route).toMatchObject({
        nameEn: 'Damascus – Aleppo',
        status: 'ACTIVE',
        editable: true,
        tripCount: 0,
        cancellationPolicy: { id: policyA, name: 'Standard' },
      });
      expect(route.stops.map((stop) => [stop.seq, stop.station.id, stop.city.id])).toEqual(
        stations.map((station, seq) => [seq, station, cities[seq]]),
      );
      expect(route.fareSets).toEqual([
        { validFrom: today, validUntil: null, currency: 'SYP', items: DEMO_FARES },
      ]);
      expect(await t.prisma.fare.count({ where: { routeId: route.id } })).toBe(6);

      const audit = await t.prisma.auditLog.findMany({
        where: { entityType: 'route', entityId: route.id },
        select: { action: true, data: true },
      });
      expect(audit).toEqual([
        {
          action: 'ROUTE_CREATED',
          data: { stopCount: 4, fareCount: 6, currency: 'SYP', cancellationPolicyId: policyA },
        },
      ]);

      const list = await t.http().get(routes(companyA)).set('Cookie', driverA).expect(200);
      expect(items<{ id: string }>(list).map((item) => item.id)).toEqual([route.id]);
    });

    it('nimmt eine eigene Haltestelle der Firma an', async () => {
      const own = await t
        .http()
        .post(`${base(companyA)}/stations`)
        .set('Cookie', adminA)
        .send({ cityId: cities[0], nameAr: 'مكتب', nameEn: 'Office' })
        .expect(201);
      const route = await createRoute(
        adminA,
        companyA,
        routeBody({
          stops: [(own.body as { id: string }).id, stations[1]],
          fares: { items: [{ fromSeq: 0, toSeq: 1, amountMinor: 100 }] },
        }),
      );
      expect(route.stops).toHaveLength(2);
      expect(route.fareSets[0]?.currency).toBe('SYP');
    });

    it('lehnt Lücken, falsche Paare, fallende Preise und doppelte Halte mit stabilem Code ab', async () => {
      const cases: [object, number, string, object?][] = [
        [
          { fares: { items: DEMO_FARES.slice(1) } },
          400,
          'FARE_MATRIX_INCOMPLETE',
          { missing: [[0, 1]] },
        ],
        [
          { fares: { items: [...DEMO_FARES, { fromSeq: 3, toSeq: 2, amountMinor: 1 }] } },
          400,
          'FARE_MATRIX_INVALID',
          { pairs: [[3, 2]] },
        ],
        [
          {
            fares: {
              items: DEMO_FARES.map((item) =>
                item.fromSeq === 0 && item.toSeq === 3 ? { ...item, amountMinor: 30_000 } : item,
              ),
            },
          },
          400,
          'FARE_NOT_MONOTONIC',
          { pair: [0, 3], contained: [1, 3] },
        ],
        [
          { stops: [stations[0], stations[1], stations[0], stations[3]] },
          400,
          'ROUTE_STOP_DUPLICATE',
        ],
        [
          {
            stops: [stations[0], stations[1], stations[2], '0199f7a4-5c2e-7d3a-9b1e-2f4c6a8d0e12'],
          },
          404,
          'STATION_NOT_FOUND',
        ],
        [
          { cancellationPolicyId: '0199f7a4-5c2e-7d3a-9b1e-2f4c6a8d0e12' },
          404,
          'CANCELLATION_POLICY_NOT_FOUND',
        ],
      ];
      for (const [overrides, status, code, params] of cases) {
        const res = await t
          .http()
          .post(routes(companyA))
          .set('Cookie', adminA)
          .send(routeBody(overrides));
        expect(res.status, code).toBe(status);
        expect(res.body).toMatchObject({ code, ...(params === undefined ? {} : { params }) });
      }
      expect(await t.prisma.route.count()).toBe(0);
    });

    it('lehnt ungültige Eingaben mit Feldpfad ab', async () => {
      const cases: [object, string][] = [
        [{ stops: [stations[0]] }, 'stops'],
        [{ nameEn: '   ' }, 'nameEn'],
        [
          { fares: { items: [{ fromSeq: 0, toSeq: 1, amountMinor: 0 }] } },
          'fares.items.0.amountMinor',
        ],
        [
          { fares: { items: [{ fromSeq: 0, toSeq: 1, amountMinor: 1.5 }] } },
          'fares.items.0.amountMinor',
        ],
        [{ fares: { currency: 'XXX', items: DEMO_FARES } }, 'fares.currency'],
      ];
      for (const [overrides, path] of cases) {
        const res = await t
          .http()
          .post(routes(companyA))
          .set('Cookie', adminA)
          .send(routeBody(overrides));
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
        expect(fieldPaths(res)).toContain(path);
      }
    });
  });

  describe('Strecken ändern', () => {
    it('ändert Namen, Stornoregel und Halte, solange keine Fahrt die Strecke nutzt', async () => {
      const route = await createRoute();
      const other = await createPolicy(adminA, companyA, { name: 'Streng', rules: [] });
      const patched = await t
        .http()
        .patch(`${routes(companyA)}/${route.id}`)
        .set('Cookie', adminA)
        .send({ nameEn: 'Damascus – Hama', cancellationPolicyId: other.id })
        .expect(200);
      expect(patched.body).toMatchObject({
        nameEn: 'Damascus – Hama',
        nameAr: 'دمشق – حلب',
        cancellationPolicy: { id: other.id, name: 'Streng' },
      });

      const replaced = await t
        .http()
        .put(`${routes(companyA)}/${route.id}/stops`)
        .set('Cookie', adminA)
        .send({
          stops: [stations[0], stations[2]],
          fares: { items: [{ fromSeq: 0, toSeq: 1, amountMinor: 40_000 }] },
        })
        .expect(200);
      const body = replaced.body as RouteBody;
      expect(body.stops.map((stop) => stop.station.id)).toEqual([stations[0], stations[2]]);
      expect(body.fareSets).toEqual([
        {
          validFrom: today,
          validUntil: null,
          currency: 'SYP',
          items: [{ fromSeq: 0, toSeq: 1, amountMinor: 40_000 }],
        },
      ]);
      expect(await t.prisma.routeStop.count({ where: { routeId: route.id } })).toBe(2);
      expect(await t.prisma.fare.count({ where: { routeId: route.id } })).toBe(1);
    });

    it('friert Halte und Stornoregel ein, sobald eine Fahrt die Strecke nutzt; Namen und Tarife bleiben änderbar', async () => {
      const route = await createRoute();
      await insertTrip(raw, {
        companyId: companyA,
        routeId: route.id,
        seatLayoutId: await layoutFor(companyA),
      });
      const other = await createPolicy(adminA, companyA, { name: 'Streng', rules: [] });

      const stops = await t
        .http()
        .put(`${routes(companyA)}/${route.id}/stops`)
        .set('Cookie', adminA)
        .send({ stops: stations.slice(0, 2), fares: { items: [DEMO_FARES[0]] } })
        .expect(409);
      expect(stops.body).toMatchObject({ code: 'ROUTE_IN_USE' });
      const policy = await t
        .http()
        .patch(`${routes(companyA)}/${route.id}`)
        .set('Cookie', adminA)
        .send({ cancellationPolicyId: other.id })
        .expect(409);
      expect(policy.body).toMatchObject({ code: 'ROUTE_IN_USE' });

      // Dieselbe Regel noch einmal zu nennen ist keine Änderung.
      const names = await t
        .http()
        .patch(`${routes(companyA)}/${route.id}`)
        .set('Cookie', adminA)
        .send({ nameEn: 'Damascus – Aleppo express', cancellationPolicyId: policyA })
        .expect(200);
      expect(names.body).toMatchObject({ editable: false, tripCount: 1 });

      // Neuer Tarifstand ab morgen: Der heutige endet morgen, der neue gilt ab morgen.
      const tomorrow = addDays(today, 1);
      const raised = DEMO_FARES.map((item) => ({ ...item, amountMinor: item.amountMinor + 5_000 }));
      const fares = await t
        .http()
        .put(`${routes(companyA)}/${route.id}/fares`)
        .set('Cookie', adminA)
        .send({ validFrom: tomorrow, items: raised })
        .expect(200);
      expect((fares.body as RouteBody).fareSets).toEqual([
        { validFrom: today, validUntil: tomorrow, currency: 'SYP', items: DEMO_FARES },
        { validFrom: tomorrow, validUntil: null, currency: 'SYP', items: raised },
      ]);

      // Ein zweiter Stand ab demselben Tag ersetzt den ersten, statt sich zu überlappen.
      const again = await t
        .http()
        .put(`${routes(companyA)}/${route.id}/fares`)
        .set('Cookie', adminA)
        .send({ validFrom: tomorrow, items: DEMO_FARES })
        .expect(200);
      expect((again.body as RouteBody).fareSets).toHaveLength(2);
      expect(await t.prisma.fare.count({ where: { routeId: route.id } })).toBe(12);
      // Halte sind unverändert, die Fahrt zeigt weiter auf sie.
      expect(await t.prisma.routeStop.count({ where: { routeId: route.id } })).toBe(4);

      const audit = await t.prisma.auditLog.findMany({
        where: { entityType: 'route', entityId: route.id, action: 'ROUTE_FARES_SET' },
        select: { data: true },
        orderBy: { occurredAt: 'asc' },
      });
      expect(audit.map((entry) => entry.data)).toEqual([
        { validFrom: tomorrow, currency: 'SYP', fareCount: 6, replaced: 0, closed: 6 },
        { validFrom: tomorrow, currency: 'SYP', fareCount: 6, replaced: 6, closed: 0 },
      ]);
    });

    it('lehnt rückwirkende und unvollständige Tarifstände ab', async () => {
      const route = await createRoute();
      const past = await t
        .http()
        .put(`${routes(companyA)}/${route.id}/fares`)
        .set('Cookie', adminA)
        .send({ validFrom: addDays(today, -1), items: DEMO_FARES })
        .expect(400);
      expect(past.body).toMatchObject({ code: 'FARE_VALID_FROM_PAST' });
      const gap = await t
        .http()
        .put(`${routes(companyA)}/${route.id}/fares`)
        .set('Cookie', adminA)
        .send({ items: DEMO_FARES.slice(0, 5) })
        .expect(400);
      expect(gap.body).toMatchObject({
        code: 'FARE_MATRIX_INCOMPLETE',
        params: { missing: [[2, 3]] },
      });
      const date = await t
        .http()
        .put(`${routes(companyA)}/${route.id}/fares`)
        .set('Cookie', adminA)
        .send({ validFrom: '2026-02-30', items: DEMO_FARES })
        .expect(400);
      expect(fieldPaths(date)).toContain('validFrom');
    });

    it('archiviert; danach keine Änderung mehr, Wiederholung ändert nichts', async () => {
      const route = await createRoute();
      const archived = await t
        .http()
        .post(`${routes(companyA)}/${route.id}/archive`)
        .set('Cookie', adminA)
        .expect(200);
      expect(archived.body).toMatchObject({ status: 'ARCHIVED', editable: false });
      await t
        .http()
        .post(`${routes(companyA)}/${route.id}/archive`)
        .set('Cookie', adminA)
        .expect(200);
      expect(await t.prisma.auditLog.count({ where: { action: 'ROUTE_ARCHIVED' } })).toBe(1);

      for (const [method, path, body] of [
        ['patch', '', { nameEn: 'X' }],
        ['put', '/fares', { items: DEMO_FARES }],
        ['put', '/stops', { stops: stations, fares: { items: DEMO_FARES } }],
      ] as const) {
        const res = await t
          .http()
          [method](`${routes(companyA)}/${route.id}${path}`)
          .set('Cookie', adminA)
          .send(body);
        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({ code: 'ROUTE_ARCHIVED' });
      }

      const active = await t
        .http()
        .get(`${routes(companyA)}?status=ACTIVE`)
        .set('Cookie', adminA);
      expect(items(active)).toHaveLength(0);
      const list = await t
        .http()
        .get(`${routes(companyA)}?status=ARCHIVED`)
        .set('Cookie', adminA);
      expect(items<{ id: string }>(list).map((item) => item.id)).toEqual([route.id]);
    });
  });

  describe('Rollen', () => {
    it('Agent und Fahrer lesen, schreiben aber nicht', async () => {
      const route = await createRoute();
      for (const cookie of [agentA, driverA]) {
        await t.http().get(routes(companyA)).set('Cookie', cookie).expect(200);
        await t
          .http()
          .get(`${routes(companyA)}/${route.id}`)
          .set('Cookie', cookie)
          .expect(200);
        await t
          .http()
          .get(`${base(companyA)}/stations`)
          .set('Cookie', cookie)
          .expect(200);
        for (const [method, path, body] of [
          ['post', '', routeBody()],
          ['patch', `/${route.id}`, { nameEn: 'X' }],
          ['put', `/${route.id}/stops`, { stops: stations, fares: { items: DEMO_FARES } }],
          ['put', `/${route.id}/fares`, { items: DEMO_FARES }],
          ['post', `/${route.id}/archive`, undefined],
        ] as const) {
          const res = await t
            .http()
            [method](`${routes(companyA)}${path}`)
            .set('Cookie', cookie)
            .send(body);
          expect(res.status, `${method} ${path}`).toBe(403);
        }
        await t
          .http()
          .post(`${base(companyA)}/cancellation-policies`)
          .set('Cookie', cookie)
          .send({ name: 'X', rules: [] })
          .expect(403);
      }
      expect(await t.prisma.route.count()).toBe(1);
    });
  });

  describe('Mandantentrennung', () => {
    it('Firma B sieht und ändert nichts von Firma A', async () => {
      const routeA = await createRoute();
      const ownA = await t
        .http()
        .post(`${base(companyA)}/stations`)
        .set('Cookie', adminA)
        .send({ cityId: cities[0], nameAr: 'مكتب أ', nameEn: 'Office A' })
        .expect(201);
      const ownStationA = (ownA.body as { id: string }).id;

      // Fremde Firma im Pfad: FORBIDDEN.
      for (const path of [
        routes(companyA),
        `${routes(companyA)}/${routeA.id}`,
        `${base(companyA)}/stations`,
        `${base(companyA)}/cancellation-policies`,
        `${base(companyA)}/cancellation-policies/${policyA}`,
      ]) {
        const res = await t.http().get(path).set('Cookie', adminB);
        expect(res.status, path).toBe(403);
      }

      // Eigene Firma im Pfad, fremde ID: wie unbekannt.
      for (const [method, path, body] of [
        ['get', `/${routeA.id}`, undefined],
        ['patch', `/${routeA.id}`, { nameEn: 'X' }],
        ['put', `/${routeA.id}/stops`, { stops: stations, fares: { items: DEMO_FARES } }],
        ['put', `/${routeA.id}/fares`, { items: DEMO_FARES }],
        ['post', `/${routeA.id}/archive`, undefined],
      ] as const) {
        const res = await t
          .http()
          [method](`${routes(companyB)}${path}`)
          .set('Cookie', adminB)
          .send(body);
        expect(res.status, `${method} ${path}`).toBe(404);
        expect(res.body).toMatchObject({ code: 'ROUTE_NOT_FOUND' });
      }
      const policy = await t
        .http()
        .get(`${base(companyB)}/cancellation-policies/${policyA}`)
        .set('Cookie', adminB)
        .expect(404);
      expect(policy.body).toMatchObject({ code: 'CANCELLATION_POLICY_NOT_FOUND' });

      // Strecke von B mit Stornoregel von A oder eigener Haltestelle von A.
      const policyB = (await createPolicy(adminB, companyB)).id;
      const foreignPolicy = await t
        .http()
        .post(routes(companyB))
        .set('Cookie', adminB)
        .send(routeBody({ cancellationPolicyId: policyA }))
        .expect(404);
      expect(foreignPolicy.body).toMatchObject({ code: 'CANCELLATION_POLICY_NOT_FOUND' });
      const foreignStation = await t
        .http()
        .post(routes(companyB))
        .set('Cookie', adminB)
        .send(
          routeBody({
            cancellationPolicyId: policyB,
            stops: [ownStationA, stations[1]],
            fares: { items: [DEMO_FARES[0]] },
          }),
        )
        .expect(404);
      expect(foreignStation.body).toMatchObject({ code: 'STATION_NOT_FOUND' });

      // Katalog von B zeigt die eigene Haltestelle von A nicht.
      const catalog = await t
        .http()
        .get(`${base(companyB)}/stations`)
        .set('Cookie', adminB);
      const names = items<{ stations: { id: string }[] }>(catalog).flatMap((city) =>
        city.stations.map((station) => station.id),
      );
      expect(names).not.toContain(ownStationA);
      expect(names).toHaveLength(4);

      // Listen enthalten nur Eigenes, und an A hat sich nichts geändert.
      expect(items(await t.http().get(routes(companyB)).set('Cookie', adminB))).toHaveLength(0);
      const a = await t.prisma.route.findUniqueOrThrow({
        where: { id: routeA.id },
        select: { nameEn: true, isActive: true, _count: { select: { stops: true, fares: true } } },
      });
      expect(a).toEqual({
        nameEn: 'Damascus – Aleppo',
        isActive: true,
        _count: { stops: 4, fares: 6 },
      });
    });

    it('die Datenbank verhindert eine Strecke mit der Stornoregel einer fremden Firma', async () => {
      await expect(
        raw.query(
          `INSERT INTO route (company_id, cancellation_policy_id, name_ar, name_en, updated_at)
           VALUES ($1, $2, 'س', 'X', now())`,
          [companyB, policyA],
        ),
      ).rejects.toMatchObject({ code: '23503' });
    });
  });

  describe('Nebenläufigkeit', () => {
    it('eine gleichzeitig angelegte Fahrt gewinnt gegen das Ersetzen der Halte', async () => {
      const route = await createRoute();
      const seatLayoutId = await layoutFor(companyA);

      // Eigene Verbindung legt die Fahrt an und hält die Transaktion offen. Ihr Fremdschlüssel
      // hält FOR KEY SHARE auf der Strecken-Zeile; die API wartet mit FOR UPDATE darauf.
      await raw.query('BEGIN');
      try {
        await insertTrip(raw, { companyId: companyA, routeId: route.id, seatLayoutId });
        const pending = t
          .http()
          .put(`${routes(companyA)}/${route.id}/stops`)
          .set('Cookie', adminA)
          .send({ stops: stations.slice(0, 2), fares: { items: [DEMO_FARES[0]] } })
          .then((res) => res);
        await waitUntilApiBlocked(observer, 1);
        await raw.query('COMMIT');
        const res = await pending;
        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({ code: 'ROUTE_IN_USE' });
      } catch (error) {
        await raw.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
      expect(await t.prisma.routeStop.count({ where: { routeId: route.id } })).toBe(4);
      expect(await t.prisma.fare.count({ where: { routeId: route.id } })).toBe(6);
    });

    it('eine gleichzeitig angelegte Fahrt gewinnt gegen den Wechsel der Stornoregel', async () => {
      const route = await createRoute();
      const other = await createPolicy(adminA, companyA, { name: 'Streng', rules: [] });
      const seatLayoutId = await layoutFor(companyA);

      await raw.query('BEGIN');
      try {
        await insertTrip(raw, { companyId: companyA, routeId: route.id, seatLayoutId });
        const pending = t
          .http()
          .patch(`${routes(companyA)}/${route.id}`)
          .set('Cookie', adminA)
          .send({ cancellationPolicyId: other.id })
          .then((res) => res);
        await waitUntilApiBlocked(observer, 1);
        await raw.query('COMMIT');
        const res = await pending;
        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({ code: 'ROUTE_IN_USE' });
      } catch (error) {
        await raw.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
      const stored = await t.prisma.route.findUniqueOrThrow({
        where: { id: route.id },
        select: { cancellationPolicyId: true },
      });
      expect(stored.cancellationPolicyId).toBe(policyA);
    });

    it('die Sperre der Strecke hält eine gleichzeitig angelegte Fahrt auf, bis sie endet', async () => {
      const route = await createRoute();
      const seatLayoutId = await layoutFor(companyA);

      // Die Strecke ist gesperrt wie im Service (FOR UPDATE); der Fremdschlüssel der neuen Fahrt
      // braucht FOR KEY SHARE und wartet. Die Fahrtplanung (2.4) sieht danach den neuen Stand.
      await raw.query('BEGIN');
      try {
        await raw.query('SELECT id FROM route WHERE id = $1 FOR UPDATE', [route.id]);
        const tripPromise = observer.query(
          `INSERT INTO trip (company_id, route_id, seat_layout_id, service_date, departure_at,
                             arrival_at, online_sales_close_at, gender_rule_enabled, updated_at)
           VALUES ($1, $2, $3, current_date + 3, now() + interval '3 days',
                   now() + interval '3 days 4 hours', now() + interval '3 days', true, now())
           RETURNING id`,
          [companyA, route.id, seatLayoutId],
        );
        // Der Beobachter blockiert jetzt selbst; eine dritte Verbindung prüft das.
        const checker = await connectRaw();
        try {
          const deadline = Date.now() + 5_000;
          let waiting = 0;
          while (Date.now() < deadline && waiting === 0) {
            const { rows } = await checker.query<{ n: string }>(
              `SELECT count(*) AS n FROM pg_stat_activity
               WHERE datname = current_database() AND application_name = 'masar-test'
                 AND wait_event_type = 'Lock'`,
            );
            waiting = Number(rows[0]?.n ?? 0);
          }
          expect(waiting).toBe(1);
        } finally {
          await checker.end();
        }
        await raw.query('COMMIT');
        const trip = await tripPromise;
        expect(trip.rows).toHaveLength(1);
      } catch (error) {
        await raw.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
      // Danach ist die Strecke genutzt: Ersetzen der Halte scheitert.
      const res = await t
        .http()
        .put(`${routes(companyA)}/${route.id}/stops`)
        .set('Cookie', adminA)
        .send({ stops: stations.slice(0, 2), fares: { items: [DEMO_FARES[0]] } });
      expect(res.status).toBe(409);
    });

    it('zwei gleichzeitige Tarifstände ab demselben Tag: einer ersetzt den anderen, keine Überlappung', async () => {
      const route = await createRoute();
      const tomorrow = addDays(today, 1);
      const results = await Promise.all(
        [5_000, 7_000].map((extra) =>
          t
            .http()
            .put(`${routes(companyA)}/${route.id}/fares`)
            .set('Cookie', adminA)
            .send({
              validFrom: tomorrow,
              items: DEMO_FARES.map((item) => ({ ...item, amountMinor: item.amountMinor + extra })),
            })
            .then((res) => res),
        ),
      );
      expect(results.map((res) => res.status)).toEqual([200, 200]);
      const fares = await t.prisma.fare.findMany({
        where: { routeId: route.id },
        select: { validFrom: true, validUntil: true },
      });
      expect(fares).toHaveLength(12);
      const open = fares.filter((fare) => fare.validUntil === null);
      expect(open).toHaveLength(6);
      expect(new Set(open.map((fare) => fare.validFrom.toISOString().slice(0, 10)))).toEqual(
        new Set([tomorrow]),
      );
    });
  });
});
