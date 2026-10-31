import { randomUUID } from 'node:crypto';

import pg from 'pg';
import type { Response as SuperResponse } from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { BookingsService } from '../src/modules/bookings/bookings.service.js';
import {
  createStaff,
  createTestApp,
  PASSWORD,
  loginAs,
  resetDatabase,
  type TestApp,
} from './helpers/app.js';
import {
  createInventoryFixture,
  fixtureFareMinor,
  type InventoryFixture,
  seatId,
} from './helpers/inventory.js';

/**
 * Buchungskern über HTTP gegen die echte Testdatenbank (Schritt 1.3, ADR 0005, 0008, 0009).
 * Jeder Block nennt das Risiko, das er abdeckt.
 */

interface BookingBody {
  bookingId?: string;
  bookingCode: string;
  manageToken?: string;
  status: string;
  paymentMethod: string | null;
  holdExpiresAt: string | null;
  deadlineAt: string | null;
  total: { amountMinor: number; currency: string };
  contact: { name: string; phone: string };
  passengers: { seatLabel: string; fullName: string; gender: string | null }[];
  tickets: { seatLabel: string; status: string }[];
}

interface ProblemBody {
  code: string;
  params?: { seats?: string[]; max?: number };
}

const asBooking = (res: SuperResponse) => res.body as BookingBody;
const asProblem = (res: SuperResponse) => res.body as ProblemBody;

let testApp: TestApp;
let phoneCounter = 0;

/** Je Buchung eine eigene syrische Mobilnummer, damit die Grenze je Telefon nicht stört. */
function nextPhone(): string {
  phoneCounter += 1;
  return `0933${String(phoneCounter).padStart(6, '0')}`;
}

function bookingRequest(
  fixture: InventoryFixture,
  passengers: { label: string; gender?: 'FEMALE' | 'MALE' }[],
  overrides: Record<string, unknown> = {},
) {
  return {
    tripId: fixture.tripId,
    fromSeq: 0,
    toSeq: 3,
    contact: { name: 'Kontaktperson Test', phone: nextPhone() },
    passengers: passengers.map((p) => ({
      seatId: seatId(fixture, p.label),
      fullName: `Fahrgast ${p.label}`,
      ...(p.gender === undefined ? {} : { gender: p.gender }),
    })),
    ...overrides,
  };
}

function book(body: object, idempotencyKey: string = randomUUID()) {
  return testApp.http().post('/api/v1/bookings').set('Idempotency-Key', idempotencyKey).send(body);
}

function myBooking(token: string | undefined) {
  const req = testApp.http().get('/api/v1/my-booking');
  return token === undefined ? req : req.set('X-Booking-Token', token);
}

function myBookingAction(action: 'cash' | 'cancel', token: string) {
  return testApp.http().post(`/api/v1/my-booking/${action}`).set('X-Booking-Token', token).send();
}

async function holdSeats(
  fixture: InventoryFixture,
  labels: string[],
  gender: 'FEMALE' | 'MALE' = 'FEMALE',
) {
  const res = await book(
    bookingRequest(
      fixture,
      labels.map((label) => ({ label, gender })),
    ),
  ).expect(201);
  return asBooking(res);
}

async function bookingIdOf(code: string): Promise<string> {
  return (await testApp.prisma.booking.findUniqueOrThrow({ where: { bookingCode: code } })).id;
}

/** Stellt die Uhr der App vor und danach zurück. */
async function withClockAdvanced<T>(ms: number, work: () => Promise<T>): Promise<T> {
  testApp.clock.advance(ms);
  try {
    return await work();
  } finally {
    testApp.clock.advance(-ms);
  }
}

beforeAll(async () => {
  testApp = await createTestApp();
});

afterAll(async () => {
  await testApp.app.close();
});

beforeEach(() => {
  testApp.resetRateLimits();
});

describe('Hold anlegen', () => {
  let trip: InventoryFixture;
  let otherTrip: InventoryFixture;

  beforeAll(async () => {
    await resetDatabase();
    trip = await createInventoryFixture(testApp.prisma, {
      withFares: true,
      rows: 3,
      offlineSeatLabels: ['11'],
      blockedSeatLabels: ['12'],
    });
    otherTrip = await createInventoryFixture(testApp.prisma, { withFares: true });
  });

  it('legt einen Hold an, gibt Code und Token einmalig zurück und belegt die Sitze', async () => {
    const res = await book(
      bookingRequest(trip, [
        { label: '1', gender: 'FEMALE' },
        { label: '2', gender: 'MALE' },
      ]),
    );
    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    const booking = asBooking(res);
    expect(booking.bookingCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(booking.manageToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(booking).toMatchObject({
      status: 'HELD',
      total: { amountMinor: 2 * fixtureFareMinor(0, 3), currency: 'SYP' },
      passengers: [
        { seatLabel: '1', gender: 'FEMALE' },
        { seatLabel: '2', gender: 'MALE' },
      ],
    });
    const holdMs =
      new Date(booking.holdExpiresAt as string).getTime() - testApp.clock.now().getTime();
    expect(holdMs).toBe(15 * 60_000);

    const bookingId = await bookingIdOf(booking.bookingCode);
    const occupations = await testApp.prisma.seatOccupation.findMany({ where: { bookingId } });
    expect(occupations.map((o) => [o.fromSeq, o.toSeq])).toEqual([
      [0, 3],
      [0, 3],
    ]);
    expect(
      await testApp.prisma.outbox.count({
        where: { aggregateId: bookingId, type: 'BOOKING_HELD' },
      }),
    ).toBe(1);
    expect(
      await testApp.prisma.auditLog.count({
        where: { entityId: bookingId, action: 'BOOKING_HELD', actorType: 'GUEST' },
      }),
    ).toBe(1);

    const map = await testApp
      .http()
      .get(`/api/v1/trips/${trip.tripId}/seat-map`)
      .query({ fromSeq: 1, toSeq: 2, gender: 'FEMALE' })
      .expect(200);
    const states = Object.fromEntries(
      (map.body as { seats: { label: string; state: string }[] }).seats.map((s) => [
        s.label,
        s.state,
      ]),
    );
    expect(states).toMatchObject({ '1': 'TAKEN', '2': 'TAKEN' });
  });

  it('liefert bei Wiederholung mit demselben Schlüssel dieselbe Buchung, ohne Token und ohne Dublette', async () => {
    const key = randomUUID();
    const body = bookingRequest(trip, [{ label: '3', gender: 'FEMALE' }]);
    const first = await book(body, key).expect(201);
    const again = await book(body, key).expect(200);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(asBooking(again).bookingCode).toBe(asBooking(first).bookingCode);
    expect(asBooking(again).manageToken).toBeUndefined();
    expect(await testApp.prisma.booking.count({ where: { idempotencyKey: key } })).toBe(1);
  });

  it('lehnt denselben Schlüssel mit einer anderen Anfrage ab', async () => {
    const key = randomUUID();
    await book(bookingRequest(trip, [{ label: '4', gender: 'FEMALE' }]), key).expect(201);
    const res = await book(bookingRequest(trip, [{ label: '5', gender: 'FEMALE' }]), key).expect(
      409,
    );
    expect(asProblem(res).code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('verlangt einen Idempotenz-Schlüssel', async () => {
    const body = bookingRequest(trip, [{ label: '6', gender: 'FEMALE' }]);
    await testApp.http().post('/api/v1/bookings').send(body).expect(400);
    const res = await book(body, 'zu-kurz').expect(400);
    expect(asProblem(res).code).toBe('VALIDATION_FAILED');
  });

  it('meldet belegte Sitze mit ihren Beschriftungen', async () => {
    await holdSeats(trip, ['7']);
    const res = await book(bookingRequest(trip, [{ label: '7', gender: 'FEMALE' }])).expect(409);
    expect(asProblem(res)).toMatchObject({ code: 'SEAT_TAKEN', params: { seats: ['7'] } });
  });

  it.each([
    ['Sitz nur am Schalter', '11', 'SEAT_NOT_ONLINE'],
    ['gesperrter Sitz', '12', 'SEAT_BLOCKED'],
  ])('lehnt ab: %s', async (_name, label, code) => {
    const res = await book(bookingRequest(trip, [{ label, gender: 'FEMALE' }])).expect(409);
    expect(asProblem(res)).toMatchObject({ code, params: { seats: [label] } });
  });

  it('lehnt einen Sitz einer anderen Fahrt ab', async () => {
    const body = bookingRequest(trip, [{ label: '8', gender: 'FEMALE' }]);
    body.passengers[0]!.seatId = seatId(otherTrip, '8');
    const res = await book(body).expect(400);
    expect(asProblem(res).code).toBe('SEAT_UNKNOWN');
  });

  it('verlangt das Geschlecht, wenn die Fahrt die Regel hat', async () => {
    const res = await book(bookingRequest(trip, [{ label: '8' }])).expect(400);
    expect(asProblem(res)).toMatchObject({ code: 'GENDER_REQUIRED', params: { seats: ['8'] } });
  });

  it('lehnt eine Frau neben einem fremden Mann ab, erlaubt aber Mann und Frau in derselben Buchung', async () => {
    await holdSeats(trip, ['9'], 'MALE');
    const conflict = await book(bookingRequest(trip, [{ label: '10', gender: 'FEMALE' }])).expect(
      409,
    );
    expect(asProblem(conflict)).toMatchObject({
      code: 'GENDER_RULE_CONFLICT',
      params: { seats: ['10'] },
    });

    const family = otherTrip;
    await book(
      bookingRequest(family, [
        { label: '1', gender: 'MALE' },
        { label: '2', gender: 'FEMALE' },
      ]),
    ).expect(201);
  });

  it('begrenzt die Sitze je Buchung', async () => {
    const fresh = await createInventoryFixture(testApp.prisma, { withFares: true });
    const labels = ['1', '2', '3', '4', '5', '6', '7'];
    const res = await book(
      bookingRequest(
        fresh,
        labels.map((label) => ({ label, gender: 'FEMALE' as const })),
      ),
    ).expect(400);
    expect(asProblem(res)).toMatchObject({ code: 'TOO_MANY_SEATS', params: { max: 6 } });
  });

  it('begrenzt offene Buchungen je Telefonnummer, unabhängig von der Schreibweise', async () => {
    const fresh = await createInventoryFixture(testApp.prisma, { withFares: true });
    const spellings = ['0944 123 456', '+963944123456', '00963 944 123 456', '0944123456'];
    for (const [index, phone] of spellings.slice(0, 3).entries()) {
      await book(
        bookingRequest(fresh, [{ label: String(index + 1), gender: 'FEMALE' }], {
          contact: { name: 'Kontaktperson Test', phone },
        }),
      ).expect(201);
    }
    const res = await book(
      bookingRequest(fresh, [{ label: '4', gender: 'FEMALE' }], {
        contact: { name: 'Kontaktperson Test', phone: spellings[3] },
      }),
    ).expect(409);
    expect(asProblem(res)).toMatchObject({ code: 'TOO_MANY_OPEN_HOLDS', params: { max: 3 } });
  });

  it('lehnt eine ungültige Telefonnummer ab', async () => {
    const res = await book(
      bookingRequest(trip, [{ label: '8', gender: 'FEMALE' }], {
        contact: { name: 'Test', phone: '12' },
      }),
    ).expect(400);
    expect(asProblem(res).code).toBe('VALIDATION_FAILED');
  });

  it.each([
    ['ein ungültiges Segment', { fromSeq: 2, toSeq: 1 }, 400, 'INVALID_SEGMENT'],
    [
      'eine unbekannte Fahrt',
      { tripId: '01a19324-0000-7000-8000-000000000000' },
      404,
      'TRIP_NOT_FOUND',
    ],
  ])('lehnt %s ab', async (_name, overrides, status, code) => {
    const res = await book(
      bookingRequest(trip, [{ label: '8', gender: 'FEMALE' }], overrides),
    ).expect(status);
    expect(asProblem(res).code).toBe(code);
  });

  it('lehnt ein Segment ohne Tarif ab', async () => {
    const noFares = await createInventoryFixture(testApp.prisma);
    const res = await book(bookingRequest(noFares, [{ label: '1', gender: 'FEMALE' }])).expect(409);
    expect(asProblem(res).code).toBe('NO_FARE_FOR_SEGMENT');
  });

  it('schließt die Online-Buchung zur Barfrist, solange bar der einzige Zahlweg ist', async () => {
    // Fixture: Barfrist 120 Minuten vor Abfahrt, Online-Verkaufsende 30 Minuten vorher.
    const untilCashDeadline =
      trip.departureAt.getTime() - 119 * 60_000 - testApp.clock.now().getTime();
    await withClockAdvanced(untilCashDeadline, async () => {
      const res = await book(bookingRequest(trip, [{ label: '8', gender: 'FEMALE' }])).expect(409);
      expect(asProblem(res).code).toBe('SALES_CLOSED');
      const search = await testApp
        .http()
        .get(`/api/v1/trips/${trip.tripId}/seat-map`)
        .query({ fromSeq: 0, toSeq: 3, gender: 'FEMALE' })
        .expect(409);
      expect(asProblem(search).code).toBe('SALES_CLOSED');
    });
  });
});

describe('Ablauf von Holds und Barreservierungen', () => {
  let trip: InventoryFixture;

  beforeAll(async () => {
    await resetDatabase();
    trip = await createInventoryFixture(testApp.prisma, { withFares: true });
  });

  it('gibt einen abgelaufenen Hold bei der nächsten Buchung derselben Fahrt frei, auch ohne Job', async () => {
    const first = await holdSeats(trip, ['1']);
    await withClockAdvanced(16 * 60_000, async () => {
      const second = await holdSeats(trip, ['1']);
      const expired = asBooking(await myBooking(first.manageToken).expect(200));
      expect(expired.status).toBe('EXPIRED');
      // Aufräumen: Der Job im nächsten Test läuft über alle Fahrten.
      await myBookingAction('cancel', second.manageToken as string).expect(200);
    });
    const bookingId = await bookingIdOf(first.bookingCode);
    expect(
      await testApp.prisma.outbox.count({
        where: { aggregateId: bookingId, type: 'BOOKING_EXPIRED' },
      }),
    ).toBe(1);
  });

  it('der Ablauf-Job gibt fällige Holds und Barreservierungen frei', async () => {
    const hold = await holdSeats(trip, ['2']);
    const reserved = await holdSeats(trip, ['3']);
    await myBookingAction('cash', reserved.manageToken as string).expect(200);

    const service = testApp.app.get(BookingsService);
    await withClockAdvanced(16 * 60_000, async () => {
      expect(await service.expireDue()).toBe(1);
    });
    // Barfrist 120 Minuten vor Abfahrt.
    const pastCashDeadline =
      trip.departureAt.getTime() - 119 * 60_000 - testApp.clock.now().getTime();
    await withClockAdvanced(pastCashDeadline, async () => {
      expect(await service.expireDue()).toBe(1);
    });
    for (const booking of [hold, reserved]) {
      const id = await bookingIdOf(booking.bookingCode);
      expect(await testApp.prisma.seatOccupation.count({ where: { bookingId: id } })).toBe(0);
      expect((await testApp.prisma.booking.findUniqueOrThrow({ where: { id } })).status).toBe(
        'EXPIRED',
      );
      expect(
        await testApp.prisma.auditLog.count({
          where: { entityId: id, action: 'BOOKING_EXPIRED', actorType: 'SYSTEM' },
        }),
      ).toBe(1);
    }
  });
});

describe('Verwaltung über das Token', () => {
  let trip: InventoryFixture;

  beforeAll(async () => {
    await resetDatabase();
    trip = await createInventoryFixture(testApp.prisma, { withFares: true });
  });

  it('zeigt die eigene Buchung mit normalisierter Telefonnummer', async () => {
    const res = await book(
      bookingRequest(trip, [{ label: '1', gender: 'FEMALE' }], {
        contact: { name: 'Kontaktperson Test', phone: '0955 222 333' },
      }),
    ).expect(201);
    const view = asBooking(await myBooking(asBooking(res).manageToken).expect(200));
    expect(view.contact).toEqual({ name: 'Kontaktperson Test', phone: '+963955222333' });
    expect(view).not.toHaveProperty('bookingId');
    expect(view).not.toHaveProperty('manageToken');
  });

  it('antwortet auf fehlendes, falsches und kaputtes Token gleich', async () => {
    for (const token of [undefined, 'A'.repeat(43), 'kein-token']) {
      const res = await myBooking(token).expect(404);
      expect(asProblem(res).code).toBe('BOOKING_NOT_FOUND');
    }
  });

  it('wechselt auf Barzahlung mit der Barfrist der Fahrt; eine Wiederholung ändert nichts', async () => {
    const booking = await holdSeats(trip, ['2']);
    const token = booking.manageToken as string;
    const reserved = asBooking(await myBookingAction('cash', token).expect(200));
    expect(reserved).toMatchObject({ status: 'RESERVED', paymentMethod: 'CASH' });
    expect(reserved.deadlineAt).toBe(
      new Date(trip.departureAt.getTime() - 120 * 60_000).toISOString(),
    );
    expect(asBooking(await myBookingAction('cash', token).expect(200)).status).toBe('RESERVED');
    const id = await bookingIdOf(booking.bookingCode);
    expect(
      await testApp.prisma.outbox.count({ where: { aggregateId: id, type: 'BOOKING_RESERVED' } }),
    ).toBe(1);
  });

  it('lehnt Barzahlung nach Ablauf des Holds ab', async () => {
    const booking = await holdSeats(trip, ['3']);
    await withClockAdvanced(16 * 60_000, async () => {
      const res = await myBookingAction('cash', booking.manageToken as string).expect(409);
      expect(asProblem(res).code).toBe('HOLD_EXPIRED');
    });
  });

  it('storniert einen Hold, gibt die Sitze sofort frei; eine Wiederholung ändert nichts', async () => {
    const booking = await holdSeats(trip, ['4']);
    const token = booking.manageToken as string;
    expect(asBooking(await myBookingAction('cancel', token).expect(200)).status).toBe('CANCELLED');
    expect(asBooking(await myBookingAction('cancel', token).expect(200)).status).toBe('CANCELLED');
    await holdSeats(trip, ['4']);
  });
});

describe('Personal der Firma', () => {
  let trip: InventoryFixture;
  let soon: InventoryFixture;
  let foreign: InventoryFixture;
  let agentCookie: string;
  let foreignAdminCookie: string;
  let driverCookie: string;
  let agentId: string;

  beforeAll(async () => {
    await resetDatabase();
    trip = await createInventoryFixture(testApp.prisma, { withFares: true });
    foreign = await createInventoryFixture(testApp.prisma, { withFares: true });
    // Abfahrt in drei Stunden, Barfrist in einer: Ablauf testbar, ohne dass die Sitzung abläuft.
    soon = await createInventoryFixture(testApp.prisma, {
      withFares: true,
      departureAt: new Date(testApp.clock.now().getTime() + 3 * 3_600_000),
    });
    agentId = (
      await createStaff(testApp.prisma, {
        email: 'agent@firma.example',
        password: PASSWORD,
        memberships: [
          { companyId: trip.companyId, role: 'AGENT' },
          { companyId: soon.companyId, role: 'AGENT' },
        ],
      })
    ).id;
    agentCookie = await loginAs(testApp, 'agent@firma.example');
    await createStaff(testApp.prisma, {
      email: 'admin@fremd.example',
      password: PASSWORD,
      memberships: [{ companyId: foreign.companyId, role: 'ADMIN' }],
    });
    foreignAdminCookie = await loginAs(testApp, 'admin@fremd.example');
    await createStaff(testApp.prisma, {
      email: 'fahrer@firma.example',
      password: PASSWORD,
      memberships: [{ companyId: trip.companyId, role: 'DRIVER' }],
    });
    driverCookie = await loginAs(testApp, 'fahrer@firma.example');
  });

  async function reservedBooking(labels: string[]) {
    const booking = await holdSeats(trip, labels);
    await myBookingAction('cash', booking.manageToken as string).expect(200);
    return booking;
  }

  function confirm(companyId: string, bookingId: string, cookie: string) {
    return testApp
      .http()
      .post(`/api/v1/companies/${companyId}/bookings/${bookingId}/confirm-cash`)
      .set('Cookie', cookie)
      .send();
  }

  it('findet eine Buchung über den Code und bestätigt die Barzahlung: Zahlung und Tickets entstehen', async () => {
    const booking = await reservedBooking(['1', '2']);
    const found = await testApp
      .http()
      .get(`/api/v1/companies/${trip.companyId}/bookings`)
      .query({ code: booking.bookingCode.toLowerCase() })
      .set('Cookie', agentCookie)
      .expect(200);
    const bookingId = asBooking(found).bookingId as string;

    const confirmed = asBooking(await confirm(trip.companyId, bookingId, agentCookie).expect(200));
    expect(confirmed.status).toBe('CONFIRMED');
    expect(confirmed.tickets.map((t) => [t.seatLabel, t.status]).sort()).toEqual([
      ['1', 'ISSUED'],
      ['2', 'ISSUED'],
    ]);
    const payments = await testApp.prisma.payment.findMany({ where: { bookingId } });
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      provider: 'CASH',
      status: 'SUCCEEDED',
      amountMinor: 2 * fixtureFareMinor(0, 3),
      confirmedByUserId: agentId,
    });
    expect(
      await testApp.prisma.auditLog.count({
        where: { entityId: bookingId, action: 'BOOKING_CONFIRMED', actorId: agentId },
      }),
    ).toBe(1);

    // Eine Wiederholung ändert nichts.
    await confirm(trip.companyId, bookingId, agentCookie).expect(200);
    expect(await testApp.prisma.payment.count({ where: { bookingId } })).toBe(1);
    expect(await testApp.prisma.ticket.count({ where: { bookingId } })).toBe(2);

    // Der Fahrgast sieht die Tickets und kann nicht mehr selbst stornieren.
    expect(asBooking(await myBooking(booking.manageToken).expect(200)).tickets).toHaveLength(2);
    const cancel = await myBookingAction('cancel', booking.manageToken as string).expect(409);
    expect(asProblem(cancel).code).toBe('BOOKING_NOT_CANCELLABLE');
  });

  it('bestätigt keinen Hold ohne gewählte Barzahlung und keine abgelaufene Reservierung', async () => {
    const hold = await holdSeats(trip, ['3']);
    const holdRes = await confirm(
      trip.companyId,
      await bookingIdOf(hold.bookingCode),
      agentCookie,
    ).expect(409);
    expect(asProblem(holdRes).code).toBe('INVALID_STATE_TRANSITION');

    const reserved = await holdSeats(soon, ['1']);
    await myBookingAction('cash', reserved.manageToken as string).expect(200);
    const pastDeadline = soon.departureAt.getTime() - 119 * 60_000 - testApp.clock.now().getTime();
    await withClockAdvanced(pastDeadline, async () => {
      const res = await confirm(
        soon.companyId,
        await bookingIdOf(reserved.bookingCode),
        agentCookie,
      ).expect(409);
      expect(asProblem(res).code).toBe('HOLD_EXPIRED');
    });
  });

  it('hält Firmen auseinander: fremde Buchungen sind unsichtbar, fremde Firmen verboten', async () => {
    const booking = await reservedBooking(['5']);
    const bookingId = await bookingIdOf(booking.bookingCode);
    // Admin der anderen Firma mit eigener companyId im Pfad: Buchung unbekannt.
    await testApp
      .http()
      .get(`/api/v1/companies/${foreign.companyId}/bookings`)
      .query({ code: booking.bookingCode })
      .set('Cookie', foreignAdminCookie)
      .expect(404);
    const own = await confirm(foreign.companyId, bookingId, foreignAdminCookie).expect(404);
    expect(asProblem(own).code).toBe('BOOKING_NOT_FOUND');
    // Mit der companyId der fremden Firma im Pfad: keine Mitgliedschaft.
    await confirm(trip.companyId, bookingId, foreignAdminCookie).expect(403);
    // Fahrer dürfen keine Zahlungen bestätigen.
    await confirm(trip.companyId, bookingId, driverCookie).expect(403);
    expect(
      (await testApp.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })).status,
    ).toBe('RESERVED');
  });

  it('storniert eine bestätigte Buchung: Tickets ungültig, Sitze frei, Grund im Audit', async () => {
    const booking = await reservedBooking(['6']);
    const bookingId = await bookingIdOf(booking.bookingCode);
    await confirm(trip.companyId, bookingId, agentCookie).expect(200);
    const res = await testApp
      .http()
      .post(`/api/v1/companies/${trip.companyId}/bookings/${bookingId}/cancel`)
      .set('Cookie', agentCookie)
      .send({ reason: 'TRIP_CHANGED' })
      .expect(200);
    expect(asBooking(res).status).toBe('CANCELLED');
    expect(asBooking(res).tickets.map((t) => t.status)).toEqual(['VOID']);
    expect(await testApp.prisma.seatOccupation.count({ where: { bookingId } })).toBe(0);
    expect(
      await testApp.prisma.auditLog.count({
        where: { entityId: bookingId, action: 'BOOKING_CANCELLED', reason: 'TRIP_CHANGED' },
      }),
    ).toBe(1);
    await holdSeats(trip, ['6']);
  });
});

describe('Nebenläufigkeit: zwei echte Anfragen gleichzeitig', { timeout: 15_000 }, () => {
  let trip: InventoryFixture;
  let barrier: pg.Client;
  let barrierOpen = false;

  beforeAll(async () => {
    await resetDatabase();
    trip = await createInventoryFixture(testApp.prisma, { withFares: true });
  });

  beforeEach(async () => {
    barrier = new pg.Client({
      connectionString: process.env.DATABASE_URL,
      application_name: 'test-barrier',
    });
    await barrier.connect();
    barrierOpen = true;
  });

  afterEach(async () => {
    if (barrierOpen) {
      await barrier.query('ROLLBACK').catch(() => undefined);
      await barrier.end();
      barrierOpen = false;
    }
  });

  /**
   * Hält die Trip-Sperre, bis beide Anfragen auf sie warten, und gibt sie dann frei. So laufen beide
   * nachweislich gleichzeitig in den kritischen Abschnitt, statt zufällig nacheinander.
   */
  async function raceThroughLock(
    requests: (() => Promise<SuperResponse>)[],
  ): Promise<SuperResponse[]> {
    await barrier.query('BEGIN');
    await barrier.query('SELECT id FROM trip WHERE id = $1 FOR UPDATE', [trip.tripId]);
    // Supertest sendet erst bei then(); ohne diesen Aufruf würde keine Anfrage warten.
    const pending = requests.map((send) => send().then((res) => res));
    const deadline = Date.now() + 4_000;
    for (;;) {
      const { rows } = await barrier.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_stat_activity
         WHERE application_name = 'masar-api' AND wait_event_type = 'Lock'`,
      );
      if ((rows[0]?.n ?? 0) >= requests.length) {
        break;
      }
      if (Date.now() > deadline) {
        throw new Error('Die Anfragen warten nicht beide auf die Trip-Sperre');
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await barrier.query('COMMIT');
    await barrier.end();
    barrierOpen = false;
    return Promise.all(pending);
  }

  it('von zwei Buchungen desselben Sitzes gewinnt genau eine', async () => {
    const [a, b] = await raceThroughLock([
      () => book(bookingRequest(trip, [{ label: '1', gender: 'FEMALE' }])),
      () => book(bookingRequest(trip, [{ label: '1', gender: 'FEMALE' }])),
    ]);
    expect([a!.status, b!.status].sort()).toEqual([201, 409]);
    expect(asProblem([a!, b!].find((r) => r.status === 409)!).code).toBe('SEAT_TAKEN');
    expect(
      await testApp.prisma.seatOccupation.count({ where: { seatId: seatId(trip, '1') } }),
    ).toBe(1);
  });

  it('Frau und Mann gleichzeitig auf Nachbarsitzen: genau eine Buchung gelingt (nur die Sperre schützt hier)', async () => {
    const [a, b] = await raceThroughLock([
      () => book(bookingRequest(trip, [{ label: '3', gender: 'FEMALE' }])),
      () => book(bookingRequest(trip, [{ label: '4', gender: 'MALE' }])),
    ]);
    expect([a!.status, b!.status].sort()).toEqual([201, 409]);
    expect(asProblem([a!, b!].find((r) => r.status === 409)!).code).toBe('GENDER_RULE_CONFLICT');
  });

  it('zwei gleichzeitige Wiederholungen mit demselben Schlüssel ergeben eine Buchung', async () => {
    const key = randomUUID();
    const body = bookingRequest(trip, [{ label: '5', gender: 'FEMALE' }]);
    const [a, b] = await raceThroughLock([() => book(body, key), () => book(body, key)]);
    expect([a!.status, b!.status].sort()).toEqual([200, 201]);
    expect(await testApp.prisma.booking.count({ where: { idempotencyKey: key } })).toBe(1);
  });
});
