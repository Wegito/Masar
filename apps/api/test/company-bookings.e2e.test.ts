import { randomUUID } from 'node:crypto';

import { formatBookingCode, localDateInDamascus } from '@masar/shared';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createBookingSchema } from '../src/modules/bookings/bookings.schemas.js';
import { BookingsService } from '../src/modules/bookings/bookings.service.js';
import {
  createStaff,
  createTestApp,
  loginAs,
  PASSWORD,
  resetDatabase,
  type TestApp,
} from './helpers/app.js';
import {
  type BookableTrip,
  bookingBody,
  createBookableTrip,
  guestPost,
  hold,
  type HeldBooking,
  postBooking,
  waitUntilApiBlocked,
} from './helpers/bookings.js';
import { connectRaw } from './helpers/inventory.js';
import { createSearchTrip } from './helpers/search.js';

/**
 * Buchungen im Portal gegen PostgreSQL (Schritt 2.5, ADR 0028): Liste mit Filtern, Freitext und
 * Cursor, Detail mit Fahrgästen, Zahlungsstand und Verlauf, Kontakt anzeigen mit Audit-Eintrag,
 * Fahrgastliste je Fahrt, Rollen, Mandantentrennung in beide Richtungen, keine Ausweisnummer und
 * kein Klartext-Telefon in Antworten sowie die Liste unter einer gleichzeitigen Buchung mit echten
 * Verbindungen. Die Log-Ausgabe prüft `company-bookings-logging.e2e.test.ts`.
 */

const MINUTE = 60_000;
const DAY = 24 * 3_600_000;
const NATIONAL_ID = '01020304050';

interface StopBody {
  tripStopId: string;
  seq: number;
  nameEn: string;
  departureAt: string | null;
  arrivalAt: string | null;
}

interface ListItemBody {
  id: string;
  bookingCode: string;
  status: string;
  channel: string;
  paymentMethod: string | null;
  paymentState: string;
  trip: { id: string; departureAt: string; status: string; route: { id: string } };
  from: StopBody;
  to: StopBody;
  contact: { name: string; phoneMasked: string };
  passengerCount: number;
  total: { amountMinor: number; currency: string };
}

interface ListBody {
  items: ListItemBody[];
  nextCursor: string | null;
}

interface DetailBody extends Omit<ListItemBody, 'contact'> {
  contact: { name: string; phoneMasked: string; hasEmail: boolean; purged: boolean };
  passengers: {
    id: string;
    seatLabel: string;
    fullName: string;
    gender: string | null;
    nationalIdPresent: boolean;
    status: string;
    ticketStatus: string | null;
  }[];
  tickets: { id: string; seatLabel: string; status: string }[];
  payments: unknown[];
  history: {
    action: string;
    actorType: string;
    actorUserId: string | null;
    fromStatus: string | null;
    toStatus: string | null;
    reason: string | null;
  }[];
  deadlineAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
}

interface PassengersBody {
  trip: { id: string; stops: StopBody[] };
  items: {
    seatLabel: string;
    fullName: string;
    gender: string | null;
    nationalIdPresent: boolean;
    bookingId: string;
    bookingStatus: string;
    paymentState: string;
    ticketStatus: string | null;
    from: StopBody;
    to: StopBody;
  }[];
  summary: {
    passengers: number;
    paid: number;
    open: number;
    perStop: { tripStopId: string; boarding: number; alighting: number }[];
  };
}

describe('Buchungen im Portal (Integration)', () => {
  let t: TestApp;

  beforeAll(async () => {
    await resetDatabase();
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.app.close();
  });

  beforeEach(() => {
    t.resetRateLimits();
    t.clock.advance(Date.now() - t.clock.now().getTime());
  });

  async function staffSession(
    companyId: string,
    role: 'ADMIN' | 'AGENT' | 'DRIVER' = 'AGENT',
  ): Promise<{ cookie: string; userId: string }> {
    const email = `staff-${randomUUID()}@firma.example`;
    const user = await createStaff(t.prisma, {
      email,
      password: PASSWORD,
      memberships: [{ companyId, role }],
    });
    return { cookie: await loginAs(t, email), userId: user.id };
  }

  function list(
    companyId: string,
    cookie: string,
    query: Record<string, string> = {},
  ): ReturnType<ReturnType<TestApp['http']>['get']> {
    return t
      .http()
      .get(`/api/v1/companies/${companyId}/bookings`)
      .query(query)
      .set('Cookie', cookie);
  }

  async function listIds(
    companyId: string,
    cookie: string,
    query: Record<string, string> = {},
  ): Promise<string[]> {
    const res = await list(companyId, cookie, query).expect(200);
    return (res.body as ListBody).items.map((item) => item.id);
  }

  function detail(
    companyId: string,
    bookingId: string,
    cookie: string,
  ): ReturnType<ReturnType<TestApp['http']>['get']> {
    return t
      .http()
      .get(`/api/v1/companies/${companyId}/bookings/${bookingId}`)
      .set('Cookie', cookie);
  }

  function staffPost(
    companyId: string,
    bookingId: string,
    action: 'confirm-cash' | 'cancel' | 'reveal-contact',
    cookie: string,
    body?: object,
  ): ReturnType<ReturnType<TestApp['http']>['post']> {
    const req = t
      .http()
      .post(`/api/v1/companies/${companyId}/bookings/${bookingId}/${action}`)
      .set('Cookie', cookie);
    return body === undefined ? req : req.send(body);
  }

  function passengers(
    companyId: string,
    tripId: string,
    cookie: string,
  ): ReturnType<ReturnType<TestApp['http']>['get']> {
    return t
      .http()
      .get(`/api/v1/companies/${companyId}/trips/${tripId}/passengers`)
      .set('Cookie', cookie);
  }

  async function reserved(
    bookable: BookableTrip,
    input: Parameters<typeof hold>[2],
  ): Promise<HeldBooking> {
    const held = await hold(t, bookable, input);
    await guestPost(t, held, 'reserve-cash').expect(200);
    return held;
  }

  describe('Liste', () => {
    let bookable: BookableTrip;
    let later: BookableTrip['trip'];
    let agent: string;
    const booked: Record<string, HeldBooking> = {};
    const phone = '+963944321987';

    beforeAll(async () => {
      bookable = await createBookableTrip(t.prisma, { commissionRateBps: 300 });
      // Zweite Fahrt derselben Firma zwei Tage später.
      later = await createSearchTrip(t.prisma, bookable.fixture, {
        departureAt: new Date(bookable.departureAt.getTime() + 2 * DAY),
      });
      agent = (await staffSession(bookable.fixture.companyId)).cookie;
      const laterTrip: BookableTrip = { ...bookable, trip: later };

      booked.held = await hold(t, bookable, { passengers: [{ label: '1A', gender: 'MALE' }] });
      booked.reserved = await reserved(bookable, {
        passengers: [
          { label: '2A', gender: 'MALE' },
          { label: '2B', gender: 'MALE' },
        ],
        phone,
      });
      booked.confirmed = await reserved(bookable, {
        passengers: [{ label: '3A', gender: 'MALE' }],
      });
      await staffPost(
        bookable.fixture.companyId,
        booked.confirmed.id,
        'confirm-cash',
        agent,
      ).expect(200);
      booked.cancelled = await hold(t, bookable, { passengers: [{ label: '4A', gender: 'MALE' }] });
      await staffPost(bookable.fixture.companyId, booked.cancelled.id, 'cancel', agent, {
        reason: 'DUPLICATE',
      }).expect(200);
      booked.later = await hold(t, laterTrip, { passengers: [{ label: '1A', gender: 'MALE' }] });
      // Schalterbuchung über den Service (die Schalter-Oberfläche folgt mit Schritt 2.6).
      const counter = await t.app
        .get(BookingsService)
        .hold(
          createBookingSchema.parse(
            bookingBody(bookable, { passengers: [{ label: '9A', gender: 'MALE' }] }),
          ),
          { channel: 'COUNTER', idempotencyKey: null, context: {} },
        );
      booked.counter = { ...counter.booking, manageToken: counter.manageToken };
    });

    it('liefert die Buchungen der Firma nach Abfahrt, mit maskiertem Telefon und Zahlungsstand', async () => {
      const res = await list(bookable.fixture.companyId, agent).expect(200);
      const body = res.body as ListBody;
      expect(body.items).toHaveLength(6);
      expect(body.nextCursor).toBeNull();
      // Zuerst die frühere Fahrt (nach ID), zuletzt die Buchung der späteren Fahrt.
      expect(body.items.at(-1)?.id).toBe(booked.later!.id);
      const departures = body.items.map((item) => item.trip.departureAt);
      expect([...departures].sort()).toEqual(departures);

      const reservedItem = body.items.find((item) => item.id === booked.reserved!.id)!;
      expect(reservedItem).toMatchObject({
        status: 'RESERVED',
        paymentMethod: 'CASH',
        paymentState: 'CASH_DUE',
        passengerCount: 2,
        channel: 'ONLINE',
        contact: { name: 'Lina Haddad', phoneMasked: '+963 9** *** 987' },
        total: { amountMinor: 120_000, currency: 'SYP' },
      });
      expect(reservedItem.from.seq).toBe(0);
      expect(reservedItem.to.seq).toBe(3);
      expect(reservedItem.from.departureAt).toBe(bookable.departureAt.toISOString());
      const states = Object.fromEntries(body.items.map((item) => [item.id, item.paymentState]));
      expect(states[booked.held!.id]).toBe('UNPAID');
      expect(states[booked.confirmed!.id]).toBe('PAID');
      expect(states[booked.cancelled!.id]).toBe('NONE');
      expect(JSON.stringify(body)).not.toContain(phone);
      expect(JSON.stringify(body)).not.toContain('321987');
    });

    it('blättert mit Cursor ohne Lücken und Doppelte; kaputter Cursor ist VALIDATION_FAILED', async () => {
      const all = await listIds(bookable.fixture.companyId, agent);
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const res = await list(bookable.fixture.companyId, agent, {
          limit: '2',
          ...(cursor === null ? {} : { cursor }),
        }).expect(200);
        const body = res.body as ListBody;
        expect(body.items.length).toBeLessThanOrEqual(2);
        seen.push(...body.items.map((item) => item.id));
        cursor = body.nextCursor;
      } while (cursor !== null);
      expect(seen).toEqual(all);

      const broken = await list(bookable.fixture.companyId, agent, { cursor: 'kaputt!' });
      expect(broken.status).toBe(400);
      expect(broken.body).toMatchObject({
        code: 'VALIDATION_FAILED',
        errors: [{ path: 'cursor', rule: 'custom' }],
      });
    });

    it('filtert nach Fahrt, Tag in Damaskus, Status, Zahlweg und Kanal', async () => {
      const companyId = bookable.fixture.companyId;
      expect(await listIds(companyId, agent, { tripId: later.tripId })).toEqual([booked.later!.id]);
      const day = localDateInDamascus(bookable.departureAt);
      const onDay = await listIds(companyId, agent, { from: day, to: day });
      expect(onDay).toHaveLength(5);
      expect(onDay).not.toContain(booked.later!.id);
      expect(await listIds(companyId, agent, { status: 'CONFIRMED' })).toEqual([
        booked.confirmed!.id,
      ]);
      expect(await listIds(companyId, agent, { status: 'CANCELLED' })).toEqual([
        booked.cancelled!.id,
      ]);
      expect((await listIds(companyId, agent, { paymentMethod: 'CASH' })).sort()).toEqual(
        [booked.reserved!.id, booked.confirmed!.id].sort(),
      );
      expect(await listIds(companyId, agent, { channel: 'COUNTER' })).toEqual([booked.counter!.id]);
      // Vergangene Tage: leer, aber gültig; verkehrter Zeitraum ist ein Schemafehler.
      expect(await listIds(companyId, agent, { from: '2020-01-01', to: '2020-01-02' })).toEqual([]);
      const reversed = await list(companyId, agent, { from: '2026-12-02', to: '2026-12-01' });
      expect(reversed.body).toMatchObject({ code: 'VALIDATION_FAILED' });
      const badStatus = await list(companyId, agent, { status: 'PAID' });
      expect(badStatus.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('zeigt einen abgelaufenen Hold schon vor dem Ablauf-Job als EXPIRED', async () => {
      const expiring = await createBookableTrip(t.prisma);
      const cookie = (await staffSession(expiring.fixture.companyId)).cookie;
      const held = await hold(t, expiring, { passengers: [{ label: '1A', gender: 'MALE' }] });
      t.clock.advance(16 * MINUTE);
      const res = await list(expiring.fixture.companyId, cookie).expect(200);
      expect((res.body as ListBody).items[0]).toMatchObject({
        id: held.id,
        status: 'EXPIRED',
        paymentState: 'NONE',
      });
      expect(await listIds(expiring.fixture.companyId, cookie, { status: 'HELD' })).toEqual([]);
      expect(await listIds(expiring.fixture.companyId, cookie, { status: 'EXPIRED' })).toEqual([
        held.id,
      ]);
      // In der Datenbank steht noch HELD; erst der Job gibt frei.
      const stored = await t.prisma.booking.findUniqueOrThrow({
        where: { id: held.id },
        select: { status: true },
      });
      expect(stored.status).toBe('HELD');
    });

    it('sucht nur im Anfang des Codes und im Ende der Telefonnummer', async () => {
      const companyId = bookable.fixture.companyId;
      const code = booked.reserved!.bookingCode;
      expect(await listIds(companyId, agent, { q: code.slice(0, 5).toLowerCase() })).toContain(
        booked.reserved!.id,
      );
      expect(await listIds(companyId, agent, { q: formatBookingCode(code) })).toEqual([
        booked.reserved!.id,
      ]);
      expect(await listIds(companyId, agent, { q: '987' })).toEqual([booked.reserved!.id]);
      expect(await listIds(companyId, agent, { q: '0944 321 987' })).toEqual([booked.reserved!.id]);
      // Ohne Zeitraum: Die Suche findet auch die Buchung der späteren Fahrt.
      expect(await listIds(companyId, agent, { q: booked.later!.bookingCode })).toEqual([
        booked.later!.id,
      ]);
      // Leerer Suchtext zählt als keine Suche.
      expect(await listIds(companyId, agent, { q: '  ' })).toHaveLength(6);

      for (const q of ['Lina Haddad', 'Khoury', '12', NATIONAL_ID.repeat(3)]) {
        const res = await list(companyId, agent, { q });
        expect(res.status, q).toBe(400);
        expect(res.body, q).toMatchObject({ code: 'BOOKING_SEARCH_INVALID' });
      }
    });
  });

  describe('Detail, Verlauf und Kontakt', () => {
    let bookable: BookableTrip;
    let agent: { cookie: string; userId: string };

    beforeAll(async () => {
      bookable = await createBookableTrip(t.prisma, {
        company: { requireNationalId: true },
        commissionRateBps: 300,
      });
      agent = await staffSession(bookable.fixture.companyId);
    });

    it('zeigt Fahrgäste, Zahlungsstand und Verlauf, Ausweisnummer nur als vorhanden', async () => {
      const phone = '+963933444555';
      const booking = await reserved(bookable, {
        passengers: [
          { label: '2B', gender: 'FEMALE', fullName: 'Rana Saleh', nationalId: NATIONAL_ID },
          { label: '2A', gender: 'MALE', fullName: 'Omar Saleh', nationalId: '99887766554' },
        ],
        phone,
        email: 'rana@example.com',
      });
      const companyId = bookable.fixture.companyId;
      const before = (await detail(companyId, booking.id, agent.cookie).expect(200))
        .body as DetailBody;
      expect(before).toMatchObject({
        status: 'RESERVED',
        paymentState: 'CASH_DUE',
        paymentMethod: 'CASH',
        payments: [],
        contact: { phoneMasked: '+963 9** *** 555', hasEmail: true, purged: false },
        tickets: [],
      });
      expect(before.deadlineAt).not.toBeNull();
      expect(
        before.passengers.map((p) => [p.seatLabel, p.fullName, p.gender, p.nationalIdPresent]),
      ).toEqual([
        ['2A', 'Omar Saleh', 'MALE', true],
        ['2B', 'Rana Saleh', 'FEMALE', true],
      ]);

      const confirmed = (
        await staffPost(companyId, booking.id, 'confirm-cash', agent.cookie).expect(200)
      ).body as DetailBody;
      expect(confirmed).toMatchObject({ status: 'CONFIRMED', paymentState: 'PAID' });
      expect(confirmed.passengers.map((p) => p.ticketStatus)).toEqual(['ISSUED', 'ISSUED']);
      expect(
        confirmed.history.map((entry) => [entry.action, entry.fromStatus, entry.toStatus]),
      ).toEqual([
        ['BOOKING_HELD', null, 'HELD'],
        ['BOOKING_RESERVED_CASH', 'HELD', 'RESERVED'],
        ['BOOKING_CONFIRMED_CASH', 'RESERVED', 'CONFIRMED'],
      ]);
      expect(confirmed.history[0]).toMatchObject({ actorType: 'GUEST', actorUserId: null });
      expect(confirmed.history[2]).toMatchObject({ actorType: 'USER', actorUserId: agent.userId });

      const cancelled = (
        await staffPost(companyId, booking.id, 'cancel', agent.cookie, {
          reason: 'OPERATIONAL',
        }).expect(200)
      ).body as DetailBody;
      expect(cancelled).toMatchObject({
        status: 'CANCELLED',
        // Bezahlt bleibt bezahlt: Erstattungen folgen mit Phase 3.
        paymentState: 'PAID',
        cancelledBy: 'COMPANY',
        cancelReason: 'OPERATIONAL',
      });
      expect(cancelled.history.at(-1)).toMatchObject({
        action: 'BOOKING_CANCELLED_BY_COMPANY',
        reason: 'OPERATIONAL',
        toStatus: 'CANCELLED',
      });

      // Weder Ausweisnummer noch ihre letzten Ziffern, weder Telefon noch E-Mail im Klartext.
      for (const body of [before, confirmed, cancelled]) {
        const json = JSON.stringify(body);
        for (const secret of [NATIONAL_ID, '4050', '99887766554', '6554', phone, '444555']) {
          expect(json, secret).not.toContain(secret);
        }
        expect(json).not.toContain('rana@example.com');
        expect(json).not.toMatch(/nationalIdLast4|nationalIdEncrypted|national_id/);
      }
    });

    it('zeigt den Kontakt nur auf Anforderung und vermerkt den Zugriff nur mit IDs', async () => {
      const phone = '+963955111222';
      const booking = await hold(t, bookable, {
        passengers: [{ label: '5A', gender: 'MALE', nationalId: NATIONAL_ID }],
        phone,
      });
      const companyId = bookable.fixture.companyId;
      const res = await staffPost(companyId, booking.id, 'reveal-contact', agent.cookie).expect(
        200,
      );
      expect(res.body).toEqual({ phone, email: null });

      const audit = await t.prisma.auditLog.findFirstOrThrow({
        where: { entityId: booking.id, action: 'BOOKING_CONTACT_REVEALED' },
        select: { actorType: true, actorId: true, companyId: true, data: true, reason: true },
      });
      expect(audit).toEqual({
        actorType: 'USER',
        actorId: agent.userId,
        companyId,
        data: { fields: ['phone'] },
        reason: null,
      });
      expect(JSON.stringify(audit)).not.toContain('955111222');
      const history = (
        (await detail(companyId, booking.id, agent.cookie).expect(200)).body as DetailBody
      ).history;
      expect(history.at(-1)).toMatchObject({
        action: 'BOOKING_CONTACT_REVEALED',
        actorUserId: agent.userId,
      });

      // Fahrer sehen weder Kontakt noch Detail noch Liste.
      const driver = await staffSession(companyId, 'DRIVER');
      // Anfragen erst im Durchlauf erzeugen: supertest startet den Server je Anfrage neu.
      for (const call of [
        () => staffPost(companyId, booking.id, 'reveal-contact', driver.cookie),
        () => detail(companyId, booking.id, driver.cookie),
        () => list(companyId, driver.cookie),
      ]) {
        const forbidden = await call();
        expect(forbidden.status).toBe(403);
        expect(forbidden.body).toMatchObject({ code: 'FORBIDDEN' });
      }
      expect(
        await t.prisma.auditLog.count({
          where: { entityId: booking.id, action: 'BOOKING_CONTACT_REVEALED' },
        }),
      ).toBe(1);
    });

    it('liefert bei Suche über den ganzen Code dieselbe maskierte Sicht', async () => {
      const booking = await hold(t, bookable, {
        passengers: [{ label: '6A', gender: 'MALE', nationalId: NATIONAL_ID }],
        phone: '+963966777888',
      });
      const res = await t
        .http()
        .post(`/api/v1/companies/${bookable.fixture.companyId}/bookings/lookup`)
        .set('Cookie', agent.cookie)
        .send({ bookingCode: formatBookingCode(booking.bookingCode).toLowerCase() })
        .expect(200);
      const body = res.body as DetailBody;
      expect(body).toMatchObject({
        id: booking.id,
        contact: { phoneMasked: '+963 9** *** 888' },
        passengers: [{ nationalIdPresent: true }],
      });
      expect(JSON.stringify(body)).not.toContain('966777888');
      expect(JSON.stringify(body)).not.toContain(NATIONAL_ID.slice(-4));
    });
  });

  describe('Fahrgastliste je Fahrt', () => {
    it('listet aktive Fahrgäste nach Sitz mit Zu- und Ausstieg, auch für Fahrer', async () => {
      const bookable = await createBookableTrip(t.prisma, {
        company: { requireNationalId: true },
        commissionRateBps: 300,
      });
      const companyId = bookable.fixture.companyId;
      const agent = (await staffSession(companyId)).cookie;
      const driver = (await staffSession(companyId, 'DRIVER')).cookie;
      const admin = (await staffSession(companyId, 'ADMIN')).cookie;

      const late = await hold(t, bookable, {
        passengers: [
          { label: '7A', gender: 'FEMALE', fullName: 'Huda Nasser', nationalId: NATIONAL_ID },
        ],
        from: 1,
        to: 2,
      });
      const early = await reserved(bookable, {
        passengers: [
          { label: '1B', gender: 'MALE', fullName: 'Sami Khoury', nationalId: NATIONAL_ID },
          { label: '1A', gender: 'MALE', fullName: 'Karim Khoury', nationalId: NATIONAL_ID },
        ],
        phone: '+963933222111',
      });
      await staffPost(companyId, early.id, 'confirm-cash', agent).expect(200);
      const gone = await hold(t, bookable, {
        passengers: [{ label: '8A', gender: 'MALE', nationalId: NATIONAL_ID }],
      });
      await staffPost(companyId, gone.id, 'cancel', agent, { reason: 'OTHER' }).expect(200);

      for (const cookie of [driver, agent, admin]) {
        const res = await passengers(companyId, bookable.trip.tripId, cookie).expect(200);
        const body = res.body as PassengersBody;
        expect(body.trip.stops.map((stop) => stop.seq)).toEqual([0, 1, 2, 3]);
        expect(
          body.items.map((item) => [
            item.seatLabel,
            item.fullName,
            item.gender,
            item.from.seq,
            item.to.seq,
            item.paymentState,
            item.ticketStatus,
          ]),
        ).toEqual([
          ['1A', 'Karim Khoury', 'MALE', 0, 3, 'PAID', 'ISSUED'],
          ['1B', 'Sami Khoury', 'MALE', 0, 3, 'PAID', 'ISSUED'],
          ['7A', 'Huda Nasser', 'FEMALE', 1, 2, 'UNPAID', null],
        ]);
        expect(body.items.every((item) => item.nationalIdPresent)).toBe(true);
        expect(body.summary).toMatchObject({ passengers: 3, paid: 2, open: 1 });
        expect(body.summary.perStop.map((stop) => [stop.boarding, stop.alighting])).toEqual([
          [2, 0],
          [1, 0],
          [0, 1],
          [0, 2],
        ]);
        const json = JSON.stringify(body);
        for (const secret of [
          NATIONAL_ID,
          NATIONAL_ID.slice(-4),
          '933222111',
          early.bookingCode,
          late.bookingCode,
          gone.id,
        ]) {
          expect(json, secret.slice(0, 3)).not.toContain(secret);
        }
        expect(json).not.toMatch(/phone|email|bookingCode/i);
      }

      // Ein abgelaufener Hold fällt heraus, auch bevor der Job ihn freigibt.
      t.clock.advance(16 * MINUTE);
      const after = (await passengers(companyId, bookable.trip.tripId, driver).expect(200))
        .body as PassengersBody;
      expect(after.items.map((item) => item.seatLabel)).toEqual(['1A', '1B']);
    });
  });

  describe('Mandantentrennung', () => {
    it('trennt Firma A und Firma B in beide Richtungen', async () => {
      const a = await createBookableTrip(t.prisma);
      const b = await createBookableTrip(t.prisma);
      const agentA = (await staffSession(a.fixture.companyId)).cookie;
      const agentB = (await staffSession(b.fixture.companyId)).cookie;
      const phone = '+963933909090';
      const bookingA = await hold(t, a, { passengers: [{ label: '1A', gender: 'MALE' }], phone });
      const bookingB = await hold(t, b, {
        passengers: [{ label: '1A', gender: 'MALE' }],
        phone: '+963933919090',
      });

      const pairs = [
        { own: a, other: b, cookie: agentA, mine: bookingA, theirs: bookingB },
        { own: b, other: a, cookie: agentB, mine: bookingB, theirs: bookingA },
      ];
      for (const { own, other, cookie, mine, theirs } of pairs) {
        const ownId = own.fixture.companyId;
        const otherId = other.fixture.companyId;
        // Eigene Liste: nur die eigene Buchung, auch bei Suche nach Code oder Telefon der anderen.
        expect(await listIds(ownId, cookie)).toEqual([mine.id]);
        expect(await listIds(ownId, cookie, { q: theirs.bookingCode })).toEqual([]);
        expect(await listIds(ownId, cookie, { q: '9090' })).toEqual([mine.id]);
        expect(await listIds(ownId, cookie, { tripId: other.trip.tripId })).toEqual([]);

        // Fremde Buchung unter der eigenen Firma: unbekannt, wie eine erfundene ID.
        for (const call of [
          () => detail(ownId, theirs.id, cookie),
          () => staffPost(ownId, theirs.id, 'reveal-contact', cookie),
          () => staffPost(ownId, theirs.id, 'confirm-cash', cookie),
          () => staffPost(ownId, theirs.id, 'cancel', cookie, { reason: 'OTHER' }),
        ]) {
          const res = await call();
          expect(res.status).toBe(404);
          expect(res.body).toMatchObject({ code: 'BOOKING_NOT_FOUND' });
        }
        const foreignTrip = await passengers(ownId, other.trip.tripId, cookie);
        expect(foreignTrip.status).toBe(404);
        expect(foreignTrip.body).toMatchObject({ code: 'TRIP_NOT_FOUND' });

        // Fremde Firma im Pfad: verboten, für jede neue Route.
        for (const call of [
          () => list(otherId, cookie),
          () => detail(otherId, theirs.id, cookie),
          () => staffPost(otherId, theirs.id, 'reveal-contact', cookie),
          () => passengers(otherId, other.trip.tripId, cookie),
        ]) {
          const res = await call();
          expect(res.status).toBe(403);
          expect(res.body).toMatchObject({ code: 'FORBIDDEN' });
        }
      }
      expect(
        await t.prisma.auditLog.count({
          where: {
            action: 'BOOKING_CONTACT_REVEALED',
            entityId: { in: [bookingA.id, bookingB.id] },
          },
        }),
      ).toBe(0);
    });
  });

  describe('Nebenläufigkeit', () => {
    let holder: pg.Client;
    let observer: pg.Client;

    beforeAll(async () => {
      holder = await connectRaw();
      observer = await connectRaw();
    });

    afterAll(async () => {
      await holder.end();
      await observer.end();
    });

    it('die Liste blockiert nicht und bleibt konsistent, während eine Buchung auf die Trip-Sperre wartet', async () => {
      const bookable = await createBookableTrip(t.prisma);
      const companyId = bookable.fixture.companyId;
      const agent = (await staffSession(companyId)).cookie;
      const first = await hold(t, bookable, { passengers: [{ label: '5A', gender: 'MALE' }] });
      const second = await hold(t, bookable, { passengers: [{ label: '6A', gender: 'MALE' }] });
      const page1 = (await list(companyId, agent, { limit: '1' }).expect(200)).body as ListBody;
      expect(page1.items).toHaveLength(1);

      await holder.query('BEGIN');
      let pending: Promise<{ status: number; body: unknown }> | undefined;
      try {
        await holder.query('SELECT id FROM trip WHERE id = $1 FOR UPDATE', [bookable.trip.tripId]);
        // Eine zweite Verbindung (Pool der API) bucht und wartet auf die Sperre.
        pending = Promise.resolve(
          postBooking(t, bookingBody(bookable, { passengers: [{ label: '7A', gender: 'MALE' }] })),
        );
        await waitUntilApiBlocked(observer, 1);

        // Währenddessen liest die Liste über eine dritte Verbindung, ohne zu warten.
        const during = await listIds(companyId, agent);
        expect(during.sort()).toEqual([first.id, second.id].sort());
        // Die zweite Seite setzt am Cursor an, ohne den Eintrag der ersten zu wiederholen.
        const page2 = (
          await list(companyId, agent, { limit: '5', cursor: page1.nextCursor! }).expect(200)
        ).body as ListBody;
        expect([...page1.items, ...page2.items].map((item) => item.id).sort()).toEqual(
          [first.id, second.id].sort(),
        );
        const tripPassengers = (
          await passengers(companyId, bookable.trip.tripId, agent).expect(200)
        ).body as PassengersBody;
        expect(tripPassengers.items.map((item) => item.seatLabel)).toEqual(['5A', '6A']);
        await holder.query('COMMIT');
      } catch (error) {
        await holder.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
      const created = await pending;
      expect(created.status).toBe(201);
      const createdId = (created.body as { booking: { id: string } }).booking.id;

      // Nach dem Commit genau einmal in der Liste, in der Fahrgastliste und auf der letzten Seite.
      const after = await listIds(companyId, agent);
      expect(after.filter((id) => id === createdId)).toHaveLength(1);
      expect(after).toHaveLength(3);
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const body = (
          await list(companyId, agent, {
            limit: '1',
            ...(cursor === null ? {} : { cursor }),
          }).expect(200)
        ).body as ListBody;
        seen.push(...body.items.map((item) => item.id));
        cursor = body.nextCursor;
      } while (cursor !== null);
      expect(seen).toEqual(after);
      const finalPassengers = (await passengers(companyId, bookable.trip.tripId, agent).expect(200))
        .body as PassengersBody;
      expect(finalPassengers.items.map((item) => item.seatLabel)).toEqual(['5A', '6A', '7A']);
    });
  });
});
