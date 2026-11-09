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
import { createBareRoute, insertTrip } from './helpers/fleet.js';
import { connectRaw } from './helpers/inventory.js';

/**
 * Flotte gegen PostgreSQL (Schritt 2.2): Sitzpläne aus dem Generator, Busse, Rollen,
 * Mandantentrennung und die Regel „ein von einer Fahrt genutzter Sitzplan ist unveränderlich".
 */

const STANDARD_45 = { name: 'Standard 45', pattern: 'TWO_PLUS_TWO', rows: 10, backBench: 5 };
const VIP_24 = { name: 'VIP 24', pattern: 'TWO_PLUS_ONE', rows: 8 };

interface LayoutBody {
  id: string;
  name: string;
  version: number;
  status: string;
  seatCount: number;
  editable: boolean;
  supersedesLayoutId: string | null;
  layout: { rows: number; columns: number };
  seats: { id: string; label: string; row: number; column: number; side: string }[];
  neighbors: [string, string][];
}

function items<T = unknown>(res: { body: unknown }): T[] {
  return (res.body as { items: T[] }).items;
}

function fieldPaths(res: { body: unknown }): string[] {
  return ((res.body as { errors?: { path: string }[] }).errors ?? []).map((error) => error.path);
}

describe('Flotte: Sitzpläne und Busse (Integration)', () => {
  let t: TestApp;
  let raw: pg.Client;
  let observer: pg.Client;
  let companyA: string;
  let companyB: string;
  let adminA: string;
  let agentA: string;
  let driverA: string;
  let adminB: string;

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
    companyA = (await createCompany(t.prisma, 'flotte-a')).id;
    companyB = (await createCompany(t.prisma, 'flotte-b')).id;
    const staff: [string, string, 'ADMIN' | 'AGENT' | 'DRIVER'][] = [
      ['admin@flotte-a.example', companyA, 'ADMIN'],
      ['agent@flotte-a.example', companyA, 'AGENT'],
      ['fahrer@flotte-a.example', companyA, 'DRIVER'],
      ['admin@flotte-b.example', companyB, 'ADMIN'],
    ];
    for (const [email, companyId, role] of staff) {
      await createStaff(t.prisma, {
        email,
        password: PASSWORD,
        memberships: [{ companyId, role }],
      });
    }
    adminA = await loginAs(t, 'admin@flotte-a.example');
    agentA = await loginAs(t, 'agent@flotte-a.example');
    driverA = await loginAs(t, 'fahrer@flotte-a.example');
    adminB = await loginAs(t, 'admin@flotte-b.example');
  });

  const layouts = (companyId: string): string => `/api/v1/companies/${companyId}/seat-layouts`;
  const buses = (companyId: string): string => `/api/v1/companies/${companyId}/buses`;

  async function createLayout(
    cookie: string,
    companyId: string,
    body: object = STANDARD_45,
  ): Promise<LayoutBody> {
    const res = await t.http().post(layouts(companyId)).set('Cookie', cookie).send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as LayoutBody;
  }

  async function createBus(
    cookie: string,
    companyId: string,
    body: { plate: string; seatLayoutId: string },
  ): Promise<{ id: string; plate: string; status: string }> {
    const res = await t.http().post(buses(companyId)).set('Cookie', cookie).send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as { id: string; plate: string; status: string };
  }

  describe('Sitzpläne', () => {
    it('legt einen 45-Sitzer mit symmetrischen Nachbarpaaren an und protokolliert ihn', async () => {
      const layout = await createLayout(adminA, companyA);
      expect(layout).toMatchObject({
        name: 'Standard 45',
        version: 1,
        pattern: 'TWO_PLUS_TWO',
        status: 'ACTIVE',
        seatCount: 45,
        tripCount: 0,
        busCount: 0,
        editable: true,
        supersedesLayoutId: null,
        layout: { rows: 11, columns: 5 },
      });
      expect(layout.seats).toHaveLength(45);
      expect(layout.seats[0]).toMatchObject({ label: '1A', row: 0, column: 0, side: 'LEFT' });
      // Je Reihe zwei Paare, Hinterbank mit fünf Sitzen als Kette aus vier Paaren.
      expect(layout.neighbors).toHaveLength(24);
      expect(layout.neighbors).toContainEqual(['11B', '11C']);
      expect(layout.neighbors).toContainEqual(['11C', '11D']);
      expect(layout.neighbors).not.toContainEqual(['1B', '1C']);

      const stored = await t.prisma.seatNeighbor.findMany({
        where: { layoutId: layout.id },
        select: { seatId: true, neighborSeatId: true },
      });
      expect(stored).toHaveLength(48);
      const keys = new Set(stored.map((pair) => `${pair.seatId}>${pair.neighborSeatId}`));
      for (const pair of stored) {
        expect(keys.has(`${pair.neighborSeatId}>${pair.seatId}`)).toBe(true);
      }

      const audit = await t.prisma.auditLog.findMany({
        where: { entityType: 'seat_layout', entityId: layout.id },
        select: { action: true, companyId: true, data: true },
      });
      expect(audit).toEqual([
        {
          action: 'SEAT_LAYOUT_CREATED',
          companyId: companyA,
          data: { pattern: 'TWO_PLUS_TWO', seatCount: 45 },
        },
      ]);
    });

    it('erzeugt 2+1 ohne Nachbarn für den Einzelsitz', async () => {
      const layout = await createLayout(adminA, companyA, VIP_24);
      expect(layout.seatCount).toBe(24);
      expect(layout.layout).toEqual({ rows: 8, columns: 3 });
      expect(layout.neighbors).toHaveLength(8);
      expect(layout.neighbors.flat()).not.toContain('1C');
    });

    it('zeigt eine Vorschau, ohne etwas zu speichern', async () => {
      const res = await t
        .http()
        .post(`${layouts(companyA)}/preview`)
        .set('Cookie', adminA)
        .send({ pattern: 'TWO_PLUS_TWO', rows: 10, backBench: 5 })
        .expect(200);
      expect(res.body).toMatchObject({
        pattern: 'TWO_PLUS_TWO',
        seatCount: 45,
        layout: { rows: 11, columns: 5 },
      });
      expect((res.body as LayoutBody).neighbors).toHaveLength(24);
      expect(await t.prisma.seatLayout.count()).toBe(0);
    });

    it('lehnt ungültige Generator-Eingaben mit Feldpfad ab', async () => {
      const cases: [object, string][] = [
        [{ ...STANDARD_45, rows: 0 }, 'rows'],
        [{ ...STANDARD_45, rows: 21 }, 'rows'],
        [{ ...STANDARD_45, rows: 2.5 }, 'rows'],
        [{ ...STANDARD_45, backBench: 1 }, 'backBench'],
        [{ ...STANDARD_45, pattern: 'CUSTOM' }, 'pattern'],
        [{ ...STANDARD_45, name: '   ' }, 'name'],
      ];
      for (const [body, path] of cases) {
        const res = await t.http().post(layouts(companyA)).set('Cookie', adminA).send(body);
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
        expect(fieldPaths(res)).toContain(path);
      }
      expect(await t.prisma.seatLayout.count()).toBe(0);
    });

    it('verlangt für einen bekannten Namen eine neue Version statt eines zweiten Plans', async () => {
      await createLayout(adminA, companyA);
      const res = await t
        .http()
        .post(layouts(companyA))
        .set('Cookie', adminA)
        .send({ ...STANDARD_45, name: ' Standard   45 ' })
        .expect(409);
      expect(res.body).toMatchObject({ code: 'SEAT_LAYOUT_NAME_TAKEN' });
      // Andere Firmen dürfen denselben Namen haben.
      await createLayout(adminB, companyB);
    });

    it('erzeugt einen unbenutzten Plan neu und benennt ihn um', async () => {
      const layout = await createLayout(adminA, companyA);
      const res = await t
        .http()
        .put(`${layouts(companyA)}/${layout.id}`)
        .set('Cookie', adminA)
        .send(VIP_24)
        .expect(200);
      expect(res.body).toMatchObject({
        id: layout.id,
        name: 'VIP 24',
        version: 1,
        pattern: 'TWO_PLUS_ONE',
        seatCount: 24,
      });
      expect(await t.prisma.seat.count({ where: { layoutId: layout.id } })).toBe(24);
      expect(await t.prisma.seatNeighbor.count({ where: { layoutId: layout.id } })).toBe(16);
    });

    it('verweigert Änderungen an einem Plan, den eine Fahrt nutzt; eine neue Version geht', async () => {
      const layout = await createLayout(adminA, companyA);
      const routeId = await createBareRoute(t.prisma, companyA);
      await insertTrip(raw, { companyId: companyA, routeId, seatLayoutId: layout.id });

      const detail = await t
        .http()
        .get(`${layouts(companyA)}/${layout.id}`)
        .set('Cookie', adminA)
        .expect(200);
      expect(detail.body).toMatchObject({ tripCount: 1, editable: false });

      const blocked = await t
        .http()
        .put(`${layouts(companyA)}/${layout.id}`)
        .set('Cookie', adminA)
        .send(VIP_24)
        .expect(409);
      expect(blocked.body).toMatchObject({ code: 'SEAT_LAYOUT_IN_USE' });
      expect(await t.prisma.seat.count({ where: { layoutId: layout.id } })).toBe(45);

      const version = await t
        .http()
        .post(`${layouts(companyA)}/${layout.id}/versions`)
        .set('Cookie', adminA)
        .send({ pattern: 'TWO_PLUS_TWO', rows: 11 })
        .expect(201);
      expect(version.body).toMatchObject({
        name: 'Standard 45',
        version: 2,
        supersedesLayoutId: layout.id,
        seatCount: 44,
        status: 'ACTIVE',
        editable: true,
      });
      // Der Vorgänger bleibt, wie er ist.
      const old = await t.prisma.seatLayout.findUniqueOrThrow({
        where: { id: layout.id },
        select: { status: true, _count: { select: { seats: true } } },
      });
      expect(old).toEqual({ status: 'ACTIVE', _count: { seats: 45 } });

      const third = await t
        .http()
        .post(`${layouts(companyA)}/${(version.body as LayoutBody).id}/versions`)
        .set('Cookie', adminA)
        .send({ pattern: 'TWO_PLUS_TWO', rows: 12 })
        .expect(201);
      expect(third.body).toMatchObject({ version: 3 });

      const list = await t.http().get(layouts(companyA)).set('Cookie', adminA).expect(200);
      expect(items<LayoutBody>(list).map((item) => item.version)).toEqual([3, 2, 1]);
    });

    it('archiviert; danach keine Änderung und kein neuer Bus, Wiederholung ändert nichts', async () => {
      const layout = await createLayout(adminA, companyA);
      const archived = await t
        .http()
        .post(`${layouts(companyA)}/${layout.id}/archive`)
        .set('Cookie', adminA)
        .expect(200);
      expect(archived.body).toMatchObject({ status: 'RETIRED', editable: false });
      await t
        .http()
        .post(`${layouts(companyA)}/${layout.id}/archive`)
        .set('Cookie', adminA)
        .expect(200);
      expect(
        await t.prisma.auditLog.count({
          where: { action: 'SEAT_LAYOUT_RETIRED', entityId: layout.id },
        }),
      ).toBe(1);

      const put = await t
        .http()
        .put(`${layouts(companyA)}/${layout.id}`)
        .set('Cookie', adminA)
        .send(STANDARD_45)
        .expect(409);
      expect(put.body).toMatchObject({ code: 'SEAT_LAYOUT_RETIRED' });

      const bus = await t
        .http()
        .post(buses(companyA))
        .set('Cookie', adminA)
        .send({ plate: 'DM-1', seatLayoutId: layout.id })
        .expect(409);
      expect(bus.body).toMatchObject({ code: 'SEAT_LAYOUT_RETIRED' });

      const active = await t
        .http()
        .get(`${layouts(companyA)}?status=ACTIVE`)
        .set('Cookie', adminA)
        .expect(200);
      expect(items(active)).toEqual([]);
    });
  });

  describe('Busse', () => {
    it('legt an, normalisiert das Kennzeichen und erkennt Dubletten in anderer Schreibweise', async () => {
      const layout = await createLayout(adminA, companyA);
      const bus = await createBus(adminA, companyA, {
        plate: ' دمشق   ١٢٣٤٥ ',
        seatLayoutId: layout.id,
      });
      expect(bus).toMatchObject({
        plate: 'دمشق 12345',
        status: 'ACTIVE',
        seatLayout: { id: layout.id, name: 'Standard 45', version: 1, seatCount: 45 },
        tripCount: 0,
      });
      const duplicate = await t
        .http()
        .post(buses(companyA))
        .set('Cookie', adminA)
        .send({ plate: 'دمشق 12345', seatLayoutId: layout.id })
        .expect(409);
      expect(duplicate.body).toMatchObject({ code: 'BUS_PLATE_TAKEN' });

      const invalid = await t
        .http()
        .post(buses(companyA))
        .set('Cookie', adminA)
        .send({ plate: '<b>', seatLayoutId: layout.id })
        .expect(400);
      expect(invalid.body).toMatchObject({ errors: [{ path: 'plate', rule: 'custom' }] });

      const audit = await t.prisma.auditLog.findFirstOrThrow({
        where: { entityType: 'bus', entityId: bus.id },
        select: { action: true, data: true },
      });
      // Nur IDs im Protokoll, kein Kennzeichen.
      expect(audit).toEqual({ action: 'BUS_CREATED', data: { seatLayoutId: layout.id } });
    });

    it('ändert Kennzeichen und Sitzplan, solange keine Fahrt den Bus nutzt', async () => {
      const standard = await createLayout(adminA, companyA);
      const vip = await createLayout(adminA, companyA, VIP_24);
      const bus = await createBus(adminA, companyA, { plate: 'DM-1', seatLayoutId: standard.id });

      const changed = await t
        .http()
        .patch(`${buses(companyA)}/${bus.id}`)
        .set('Cookie', adminA)
        .send({ plate: 'dm-2', seatLayoutId: vip.id })
        .expect(200);
      expect(changed.body).toMatchObject({ plate: 'DM-2', seatLayout: { id: vip.id } });

      const routeId = await createBareRoute(t.prisma, companyA);
      const tripId = await insertTrip(raw, {
        companyId: companyA,
        routeId,
        seatLayoutId: vip.id,
        busId: bus.id,
      });
      const blocked = await t
        .http()
        .patch(`${buses(companyA)}/${bus.id}`)
        .set('Cookie', adminA)
        .send({ seatLayoutId: standard.id })
        .expect(409);
      expect(blocked.body).toMatchObject({ code: 'BUS_IN_USE' });
      // Der Fremdschlüssel mit ON UPDATE CASCADE hätte den Plan der Fahrt mitgeändert.
      const trip = await t.prisma.trip.findUniqueOrThrow({
        where: { id: tripId },
        select: { seatLayoutId: true },
      });
      expect(trip.seatLayoutId).toBe(vip.id);

      // Das Kennzeichen bleibt auch mit Fahrten änderbar.
      await t
        .http()
        .patch(`${buses(companyA)}/${bus.id}`)
        .set('Cookie', adminA)
        .send({ plate: 'DM-3' })
        .expect(200);

      const empty = await t
        .http()
        .patch(`${buses(companyA)}/${bus.id}`)
        .set('Cookie', adminA)
        .send({})
        .expect(400);
      expect(empty.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('deaktiviert und aktiviert; eine Wiederholung ändert nichts', async () => {
      const layout = await createLayout(adminA, companyA);
      const bus = await createBus(adminA, companyA, { plate: 'DM-1', seatLayoutId: layout.id });
      for (let i = 0; i < 2; i += 1) {
        const res = await t
          .http()
          .post(`${buses(companyA)}/${bus.id}/deactivate`)
          .set('Cookie', adminA)
          .expect(200);
        expect(res.body).toMatchObject({ status: 'INACTIVE' });
      }
      await t
        .http()
        .post(`${buses(companyA)}/${bus.id}/activate`)
        .set('Cookie', adminA)
        .expect(200);
      const actions = await t.prisma.auditLog.findMany({
        where: { entityType: 'bus', entityId: bus.id },
        orderBy: { occurredAt: 'asc' },
        select: { action: true },
      });
      expect(actions.map((entry) => entry.action)).toEqual([
        'BUS_CREATED',
        'BUS_DEACTIVATED',
        'BUS_ACTIVATED',
      ]);
    });
  });

  describe('Rollen', () => {
    it('Agent und Fahrer lesen, schreiben aber nicht', async () => {
      const layout = await createLayout(adminA, companyA);
      const bus = await createBus(adminA, companyA, { plate: 'DM-1', seatLayoutId: layout.id });
      for (const cookie of [agentA, driverA]) {
        await t.http().get(layouts(companyA)).set('Cookie', cookie).expect(200);
        await t
          .http()
          .get(`${layouts(companyA)}/${layout.id}`)
          .set('Cookie', cookie)
          .expect(200);
        await t.http().get(buses(companyA)).set('Cookie', cookie).expect(200);
        await t
          .http()
          .get(`${buses(companyA)}/${bus.id}`)
          .set('Cookie', cookie)
          .expect(200);

        const writes = [
          () => t.http().post(layouts(companyA)).set('Cookie', cookie).send(STANDARD_45),
          () =>
            t
              .http()
              .post(`${layouts(companyA)}/preview`)
              .set('Cookie', cookie)
              .send(STANDARD_45),
          () =>
            t
              .http()
              .put(`${layouts(companyA)}/${layout.id}`)
              .set('Cookie', cookie)
              .send(STANDARD_45),
          () =>
            t
              .http()
              .post(`${layouts(companyA)}/${layout.id}/versions`)
              .set('Cookie', cookie)
              .send(STANDARD_45),
          () =>
            t
              .http()
              .post(`${layouts(companyA)}/${layout.id}/archive`)
              .set('Cookie', cookie),
          () =>
            t
              .http()
              .post(buses(companyA))
              .set('Cookie', cookie)
              .send({ plate: 'X-1', seatLayoutId: layout.id }),
          () =>
            t
              .http()
              .patch(`${buses(companyA)}/${bus.id}`)
              .set('Cookie', cookie)
              .send({ plate: 'X-2' }),
          () =>
            t
              .http()
              .post(`${buses(companyA)}/${bus.id}/deactivate`)
              .set('Cookie', cookie),
          () =>
            t
              .http()
              .post(`${buses(companyA)}/${bus.id}/activate`)
              .set('Cookie', cookie),
        ];
        for (const write of writes) {
          const res = await write();
          expect(res.status).toBe(403);
          expect(res.body).toMatchObject({ code: 'FORBIDDEN' });
        }
      }
      expect(await t.prisma.seatLayout.count()).toBe(1);
      expect(await t.prisma.bus.findUniqueOrThrow({ where: { id: bus.id } })).toMatchObject({
        plate: 'DM-1',
        status: 'ACTIVE',
      });
    });
  });

  describe('Mandantentrennung', () => {
    it('Firma B sieht und ändert nichts von Firma A', async () => {
      const layoutA = await createLayout(adminA, companyA);
      const busA = await createBus(adminA, companyA, { plate: 'DM-1', seatLayoutId: layoutA.id });
      const layoutB = await createLayout(adminB, companyB, VIP_24);

      // Fremde Firma im Pfad: FORBIDDEN, für jede Route.
      for (const path of [
        layouts(companyA),
        `${layouts(companyA)}/${layoutA.id}`,
        buses(companyA),
        `${buses(companyA)}/${busA.id}`,
      ]) {
        const res = await t.http().get(path).set('Cookie', adminB);
        expect(res.status).toBe(403);
      }

      // Eigene Firma im Pfad, fremde ID: wie unbekannt.
      const asB = (
        method: 'get' | 'put' | 'post' | 'patch',
        path: string,
        body?: object,
      ): Promise<{ status: number; body: { code?: string } }> =>
        t
          .http()
          [method](path)
          .set('Cookie', adminB)
          .send(body)
          .then((res) => res);
      const cases = [
        () => asB('get', `${layouts(companyB)}/${layoutA.id}`),
        () => asB('put', `${layouts(companyB)}/${layoutA.id}`, STANDARD_45),
        () => asB('post', `${layouts(companyB)}/${layoutA.id}/versions`, STANDARD_45),
        () => asB('post', `${layouts(companyB)}/${layoutA.id}/archive`),
        () => asB('post', buses(companyB), { plate: 'B-1', seatLayoutId: layoutA.id }),
      ];
      for (const request of cases) {
        const res = await request();
        expect(res.status).toBe(404);
        expect(res.body).toMatchObject({ code: 'SEAT_LAYOUT_NOT_FOUND' });
      }
      for (const request of [
        () => asB('get', `${buses(companyB)}/${busA.id}`),
        () => asB('patch', `${buses(companyB)}/${busA.id}`, { plate: 'B-2' }),
        () => asB('post', `${buses(companyB)}/${busA.id}/deactivate`),
      ]) {
        const res = await request();
        expect(res.status).toBe(404);
        expect(res.body).toMatchObject({ code: 'BUS_NOT_FOUND' });
      }

      // Eigener Bus, fremder Sitzplan.
      const busB = await createBus(adminB, companyB, { plate: 'DM-1', seatLayoutId: layoutB.id });
      const swap = await t
        .http()
        .patch(`${buses(companyB)}/${busB.id}`)
        .set('Cookie', adminB)
        .send({ seatLayoutId: layoutA.id })
        .expect(404);
      expect(swap.body).toMatchObject({ code: 'SEAT_LAYOUT_NOT_FOUND' });

      // Listen enthalten nur Eigenes.
      const listB = await t.http().get(layouts(companyB)).set('Cookie', adminB).expect(200);
      expect(items<{ id: string }>(listB).map((item) => item.id)).toEqual([layoutB.id]);
      const busesB = await t.http().get(buses(companyB)).set('Cookie', adminB).expect(200);
      expect(items<{ id: string }>(busesB).map((item) => item.id)).toEqual([busB.id]);

      // Nichts an A hat sich geändert.
      const a = await t.prisma.seatLayout.findUniqueOrThrow({
        where: { id: layoutA.id },
        select: { status: true, version: true, _count: { select: { seats: true } } },
      });
      expect(a).toEqual({ status: 'ACTIVE', version: 1, _count: { seats: 45 } });
      expect(await t.prisma.seatLayout.count({ where: { companyId: companyB } })).toBe(1);
      expect(await t.prisma.bus.findUniqueOrThrow({ where: { id: busA.id } })).toMatchObject({
        plate: 'DM-1',
        status: 'ACTIVE',
      });
    });

    it('die Datenbank verhindert einen Bus mit dem Sitzplan einer fremden Firma', async () => {
      const layoutA = await createLayout(adminA, companyA);
      await expect(
        raw.query(
          `INSERT INTO bus (company_id, plate, seat_layout_id, updated_at)
           VALUES ($1, 'X-1', $2, now())`,
          [companyB, layoutA.id],
        ),
      ).rejects.toMatchObject({ code: '23503' });
    });
  });

  describe('Nebenläufigkeit', () => {
    it('eine gleichzeitig angelegte Fahrt gewinnt gegen das Neuerzeugen des Plans', async () => {
      const layout = await createLayout(adminA, companyA);
      const routeId = await createBareRoute(t.prisma, companyA);

      // Eigene Verbindung legt die Fahrt an und hält die Transaktion offen. Ihr Fremdschlüssel
      // hält FOR KEY SHARE auf der Sitzplan-Zeile; die API wartet mit FOR UPDATE darauf.
      await raw.query('BEGIN');
      try {
        await insertTrip(raw, { companyId: companyA, routeId, seatLayoutId: layout.id });
        const pending = t
          .http()
          .put(`${layouts(companyA)}/${layout.id}`)
          .set('Cookie', adminA)
          .send(VIP_24)
          .then((res) => res);
        await waitUntilApiBlocked(observer, 1);
        await raw.query('COMMIT');
        const res = await pending;
        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({ code: 'SEAT_LAYOUT_IN_USE' });
      } catch (error) {
        await raw.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
      expect(await t.prisma.seat.count({ where: { layoutId: layout.id } })).toBe(45);
    });

    it('eine gleichzeitig angelegte Fahrt gewinnt gegen den Sitzplanwechsel des Busses', async () => {
      const standard = await createLayout(adminA, companyA);
      const vip = await createLayout(adminA, companyA, VIP_24);
      const bus = await createBus(adminA, companyA, { plate: 'DM-1', seatLayoutId: standard.id });
      const routeId = await createBareRoute(t.prisma, companyA);

      await raw.query('BEGIN');
      try {
        const tripId = await insertTrip(raw, {
          companyId: companyA,
          routeId,
          seatLayoutId: standard.id,
          busId: bus.id,
        });
        const pending = t
          .http()
          .patch(`${buses(companyA)}/${bus.id}`)
          .set('Cookie', adminA)
          .send({ seatLayoutId: vip.id })
          .then((res) => res);
        await waitUntilApiBlocked(observer, 1);
        await raw.query('COMMIT');
        const res = await pending;
        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({ code: 'BUS_IN_USE' });
        const trip = await t.prisma.trip.findUniqueOrThrow({
          where: { id: tripId },
          select: { seatLayoutId: true },
        });
        expect(trip.seatLayoutId).toBe(standard.id);
      } catch (error) {
        await raw.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
    });

    it('zwei gleichzeitige Busse mit demselben Kennzeichen: genau einer entsteht', async () => {
      const layout = await createLayout(adminA, companyA);
      const results = await Promise.all(
        [0, 1].map(() =>
          t
            .http()
            .post(buses(companyA))
            .set('Cookie', adminA)
            .send({ plate: 'DM-9', seatLayoutId: layout.id })
            .then((res) => res),
        ),
      );
      expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
      expect(results.find((res) => res.status === 409)?.body).toMatchObject({
        code: 'BUS_PLATE_TAKEN',
      });
      expect(await t.prisma.bus.count({ where: { companyId: companyA } })).toBe(1);
    });
  });
});
