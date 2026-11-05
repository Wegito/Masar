import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { hashSecret } from '../src/modules/bookings/domain/secrets.js';
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
  bookingState,
  createBookableTrip,
  hold,
  nextPhone,
  type PassengerInput,
  postBooking,
} from './helpers/bookings.js';

/**
 * Schaltermodus gegen PostgreSQL (Schritt 2.6, ADR 0030): Barverkauf im selben Inventar wie online
 * (sofort bestätigt, Tickets mit QR, ohne Hold und ohne Verwaltungstoken), Kontingent (Schalter
 * verkauft auch nicht-online Sitze), Teilstrecken, Geschlechtsregel, Ausweisnummer nur
 * verschlüsselt, Idempotenz, Preisvorschau, Sitzplan des Personals, Storno, Rollen und
 * Mandantentrennung in beide Richtungen. Nebenläufigkeit: `counter-concurrency.e2e.test.ts`,
 * Log-Ausgabe: `counter-logging.e2e.test.ts`.
 */

const MINUTE = 60_000;
const NATIONAL_ID = '01020304050';

interface SaleBody {
  booking: {
    id: string;
    bookingCode: string;
    status: string;
    channel: string;
    paymentMethod: string | null;
    paymentState: string;
    holdExpiresAt: string | null;
    deadlineAt: string | null;
    confirmedAt: string | null;
    contact: { name: string; phoneMasked: string };
    total: { amountMinor: number; currency: string };
    passengers: { seatLabel: string; gender: string | null; nationalIdPresent: boolean }[];
    tickets: { id: string; seatLabel: string; status: string }[];
    history: { action: string; actorType: string; actorUserId: string | null }[];
  };
}

interface SeatMapBody {
  trip: { id: string; stops: { tripStopId: string; seq: number }[] };
  from: { tripStopId: string; seq: number };
  to: { tripStopId: string; seq: number };
  fare: { amountMinor: number; currency: string } | null;
  salesOpen: boolean;
  genderRuleEnabled: boolean;
  nationalIdRequired: boolean;
  seats: {
    seatId: string;
    label: string;
    quota: string;
    state: string;
    occupiedRanges: { fromSeq: number; toSeq: number }[];
    selectableFor: { FEMALE: boolean; MALE: boolean } | null;
  }[];
  summary: { free: number; taken: number; blocked: number; counterOnly: number };
}

describe('Schaltermodus (Integration)', () => {
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

  function sell(
    companyId: string,
    cookie: string,
    body: Record<string, unknown>,
    key: string | null = randomUUID(),
  ): ReturnType<ReturnType<TestApp['http']>['post']> {
    const req = t.http().post(`/api/v1/companies/${companyId}/counter/sales`).set('Cookie', cookie);
    return (key === null ? req : req.set('Idempotency-Key', key)).send(body);
  }

  function seatMap(
    companyId: string,
    tripId: string,
    cookie: string,
    query: Record<string, string> = {},
  ): ReturnType<ReturnType<TestApp['http']>['get']> {
    return t
      .http()
      .get(`/api/v1/companies/${companyId}/trips/${tripId}/counter-seat-map`)
      .query(query)
      .set('Cookie', cookie);
  }

  function quote(
    companyId: string,
    cookie: string,
    body: Record<string, unknown>,
  ): ReturnType<ReturnType<TestApp['http']>['post']> {
    return t
      .http()
      .post(`/api/v1/companies/${companyId}/counter/quote`)
      .set('Cookie', cookie)
      .send(body);
  }

  function body(
    bookable: BookableTrip,
    passengers: PassengerInput[],
    extra: { from?: number; to?: number; phone?: string } = {},
  ): Record<string, unknown> {
    return bookingBody(bookable, { passengers, ...extra });
  }

  const code = (res: { body: unknown }): string | undefined => (res.body as { code?: string }).code;

  it('verkauft bar: sofort bestätigt, mit Tickets, ohne Hold, ohne Verwaltungstoken', async () => {
    const bookable = await createBookableTrip(t.prisma, { commissionRateBps: 0 });
    const { companyId } = bookable.fixture;
    const staff = await staffSession(companyId, 'AGENT');

    const res = await sell(
      companyId,
      staff.cookie,
      body(bookable, [
        { label: '1A', gender: 'MALE' },
        { label: '1B', gender: 'FEMALE', fullName: 'Rania Haddad' },
      ]),
    ).expect(201);
    const sale = (res.body as SaleBody).booking;
    expect(sale.status).toBe('CONFIRMED');
    expect(sale.channel).toBe('COUNTER');
    expect(sale.paymentMethod).toBe('CASH');
    expect(sale.paymentState).toBe('PAID');
    expect(sale.holdExpiresAt).toBeNull();
    expect(sale.deadlineAt).toBeNull();
    expect(sale.confirmedAt).not.toBeNull();
    // Tarif 0→3 ist 60 000 je Fahrgast.
    expect(sale.total).toEqual({ amountMinor: 120_000, currency: 'SYP' });
    expect(sale.tickets.map((ticket) => [ticket.seatLabel, ticket.status])).toEqual([
      ['1A', 'ISSUED'],
      ['1B', 'ISSUED'],
    ]);
    expect(sale.contact.phoneMasked).toMatch(/^\+963 9\*\* \*\*\* \d{3}$/);
    expect(JSON.stringify(res.body)).not.toContain('manageToken');
    expect(sale.history).toEqual([
      expect.objectContaining({
        action: 'BOOKING_SOLD_AT_COUNTER',
        actorType: 'USER',
        actorUserId: staff.userId,
      }),
    ]);

    const row = await t.prisma.booking.findUniqueOrThrow({
      where: { id: sale.id },
      select: { manageTokenHash: true, commissionRateBps: true, commissionAmountMinor: true },
    });
    expect(row).toEqual({ manageTokenHash: null, commissionRateBps: 0, commissionAmountMinor: 0 });
    expect(await bookingState(t.prisma, sale.id)).toEqual({
      status: 'CONFIRMED',
      occupations: 2,
      tickets: ['ISSUED', 'ISSUED'],
    });
    const outbox = await t.prisma.outbox.findMany({
      where: { aggregateId: sale.id },
      select: { type: true },
    });
    expect(outbox.map((entry) => entry.type)).toEqual(['BOOKING_CONFIRMED']);

    // Ticket zum Drucken: QR-Token je Sitz, ohne Kontaktdaten.
    const ticket = await t
      .http()
      .get(`/api/v1/companies/${companyId}/bookings/${sale.id}/ticket`)
      .set('Cookie', staff.cookie)
      .expect(200);
    const tickets = (ticket.body as { tickets: { seatLabel: string; qrToken: string | null }[] })
      .tickets;
    expect(tickets.map((entry) => entry.seatLabel)).toEqual(['1A', '1B']);
    for (const entry of tickets) {
      expect(entry.qrToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
    expect(JSON.stringify(ticket.body)).not.toMatch(/\+963|FEMALE|MALE/);
  });

  it('verkauft Sitze außerhalb des Online-Kontingents und online-verkäufliche; gesperrte nie', async () => {
    const bookable = await createBookableTrip(t.prisma, {
      trip: { onlineLabels: ['1A', '1B'], blockedLabels: ['3A'] },
    });
    const { companyId } = bookable.fixture;
    const staff = await staffSession(companyId);

    // Online geht 2A nicht, am Schalter schon.
    const online = await postBooking(t, body(bookable, [{ label: '2A', gender: 'MALE' }]));
    expect([online.status, code(online)]).toEqual([409, 'SEAT_NOT_ONLINE']);
    await sell(companyId, staff.cookie, body(bookable, [{ label: '2A', gender: 'MALE' }])).expect(
      201,
    );
    // Online-Sitz am Schalter verkaufen; danach ist er online belegt.
    await sell(companyId, staff.cookie, body(bookable, [{ label: '1A', gender: 'MALE' }])).expect(
      201,
    );
    const taken = await postBooking(t, body(bookable, [{ label: '1A', gender: 'MALE' }]));
    expect([taken.status, code(taken)]).toEqual([409, 'SEAT_TAKEN']);

    const blocked = await sell(
      companyId,
      staff.cookie,
      body(bookable, [{ label: '3A', gender: 'MALE' }]),
    );
    expect([blocked.status, code(blocked)]).toEqual([409, 'SEAT_BLOCKED']);
    const unknown = await sell(
      companyId,
      staff.cookie,
      body(bookable, [{ label: randomUUID(), gender: 'MALE' }]),
    );
    expect([unknown.status, code(unknown)]).toEqual([400, 'SEAT_UNKNOWN']);

    // Der Sitzplan des Personals zeigt Kontingent und Belegung.
    const map = (await seatMap(companyId, bookable.trip.tripId, staff.cookie).expect(200))
      .body as SeatMapBody;
    const seat = (label: string) => map.seats.find((entry) => entry.label === label)!;
    expect(seat('2A')).toMatchObject({ quota: 'COUNTER', state: 'TAKEN' });
    expect(seat('1A')).toMatchObject({ quota: 'ONLINE', state: 'TAKEN' });
    expect(seat('2B')).toMatchObject({ quota: 'COUNTER', state: 'FREE' });
    expect(seat('3A')).toMatchObject({ quota: 'BLOCKED', state: 'BLOCKED' });
    expect(map.summary.taken).toBe(2);
    expect(map.summary.blocked).toBe(1);
    expect(map.salesOpen).toBe(true);
    expect(map.fare).toEqual({ amountMinor: 60_000, currency: 'SYP' });
  });

  it('nutzt Teilstrecken halboffen: angrenzend verkaufbar, überlappend nicht', async () => {
    const bookable = await createBookableTrip(t.prisma);
    const { companyId } = bookable.fixture;
    const staff = await staffSession(companyId);
    const seat = [{ label: '4A', gender: 'MALE' as const }];

    await sell(companyId, staff.cookie, body(bookable, seat, { from: 0, to: 2 })).expect(201);
    await sell(companyId, staff.cookie, body(bookable, seat, { from: 2, to: 3 })).expect(201);
    const overlap = await sell(companyId, staff.cookie, body(bookable, seat, { from: 1, to: 3 }));
    expect([overlap.status, code(overlap)]).toEqual([409, 'SEAT_TAKEN']);
    const reversed = await sell(companyId, staff.cookie, body(bookable, seat, { from: 2, to: 1 }));
    expect([reversed.status, code(reversed)]).toEqual([400, 'INVALID_SEGMENT']);

    const stops = bookable.trip.tripStopIds;
    const map = (
      await seatMap(companyId, bookable.trip.tripId, staff.cookie, {
        fromStopId: stops[1]!,
        toStopId: stops[2]!,
      }).expect(200)
    ).body as SeatMapBody;
    const entry = map.seats.find((s) => s.label === '4A')!;
    expect(entry.state).toBe('TAKEN');
    expect(entry.occupiedRanges).toEqual([{ fromSeq: 0, toSeq: 3 }]);
    expect(map.from.seq).toBe(1);
    expect(map.to.seq).toBe(2);
    expect(map.fare).toEqual({ amountMinor: 15_000, currency: 'SYP' });
    // Ohne Halte: die ganze Fahrt.
    const full = (await seatMap(companyId, bookable.trip.tripId, staff.cookie).expect(200))
      .body as SeatMapBody;
    expect([full.from.seq, full.to.seq]).toEqual([0, 3]);
  });

  it('hält die Geschlechtsregel ein; dieselbe Buchung ist ausgenommen', async () => {
    const bookable = await createBookableTrip(t.prisma);
    const { companyId } = bookable.fixture;
    const staff = await staffSession(companyId);
    await hold(t, bookable, { passengers: [{ label: '5A', gender: 'FEMALE' }] });

    const map = (await seatMap(companyId, bookable.trip.tripId, staff.cookie).expect(200))
      .body as SeatMapBody;
    expect(map.genderRuleEnabled).toBe(true);
    expect(map.seats.find((s) => s.label === '5B')?.selectableFor).toEqual({
      FEMALE: true,
      MALE: false,
    });
    expect(JSON.stringify(map)).not.toMatch(/"gender"/);

    const man = await sell(
      companyId,
      staff.cookie,
      body(bookable, [{ label: '5B', gender: 'MALE' }]),
    );
    expect([man.status, code(man)]).toEqual([409, 'GENDER_RULE_CONFLICT']);
    expect((man.body as { params?: { seats?: string[] } }).params?.seats).toEqual(['5B']);
    const missing = await sell(companyId, staff.cookie, body(bookable, [{ label: '6A' }]));
    expect([missing.status, code(missing)]).toEqual([400, 'GENDER_REQUIRED']);
    await sell(companyId, staff.cookie, body(bookable, [{ label: '5B', gender: 'FEMALE' }])).expect(
      201,
    );
    await sell(
      companyId,
      staff.cookie,
      body(bookable, [
        { label: '6A', gender: 'FEMALE' },
        { label: '6B', gender: 'MALE' },
      ]),
    ).expect(201);
  });

  it('speichert die Ausweisnummer nur verschlüsselt und nur, wenn die Firma sie verlangt', async () => {
    const bookable = await createBookableTrip(t.prisma, { company: { requireNationalId: true } });
    const { companyId } = bookable.fixture;
    const staff = await staffSession(companyId);
    const map = (await seatMap(companyId, bookable.trip.tripId, staff.cookie).expect(200))
      .body as SeatMapBody;
    expect(map.nationalIdRequired).toBe(true);

    const without = await sell(
      companyId,
      staff.cookie,
      body(bookable, [{ label: '7A', gender: 'MALE' }]),
    );
    expect([without.status, code(without)]).toEqual([400, 'NATIONAL_ID_REQUIRED']);
    const res = await sell(
      companyId,
      staff.cookie,
      body(bookable, [{ label: '7A', gender: 'MALE', nationalId: NATIONAL_ID }]),
    ).expect(201);
    const sale = (res.body as SaleBody).booking;
    expect(sale.passengers[0]?.nationalIdPresent).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(NATIONAL_ID);
    expect(JSON.stringify(res.body)).not.toContain(NATIONAL_ID.slice(-4));
    const passenger = await t.prisma.bookingPassenger.findFirstOrThrow({
      where: { bookingId: sale.id },
      select: { nationalIdEncrypted: true, nationalIdKeyId: true },
    });
    expect(passenger.nationalIdKeyId).not.toBeNull();
    expect(Buffer.from(passenger.nationalIdEncrypted!).toString('latin1')).not.toContain(
      NATIONAL_ID,
    );
  });

  it('gilt ohne die Grenze offener Buchungen je Telefon und verkauft bis zur Abfahrt', async () => {
    // Abfahrt in 20 Minuten: Der Online-Verkauf endet 30 Minuten vorher, ist also schon zu.
    const departureAt = new Date(Date.now() + 20 * MINUTE);
    const bookable = await createBookableTrip(t.prisma, { trip: { departureAt } });
    const other = await createBookableTrip(t.prisma);
    const { companyId } = bookable.fixture;
    const staff = await staffSession(companyId);
    const phone = nextPhone();
    for (const label of ['8A', '8B', '8C']) {
      await hold(t, other, { passengers: [{ label, gender: 'MALE' }], phone });
    }
    const online = await postBooking(t, body(other, [{ label: '8D', gender: 'MALE' }], { phone }));
    expect([online.status, code(online)]).toEqual([409, 'TOO_MANY_OPEN_HOLDS']);
    const closed = await postBooking(t, body(bookable, [{ label: '8A', gender: 'MALE' }]));
    expect([closed.status, code(closed)]).toEqual([409, 'SALES_CLOSED']);

    await sell(
      companyId,
      staff.cookie,
      body(bookable, [{ label: '8A', gender: 'MALE' }], { phone }),
    ).expect(201);

    // Nach der Abfahrt verkauft auch der Schalter nicht mehr.
    t.clock.advance(departureAt.getTime() - Date.now() + MINUTE);
    const late = await sell(
      companyId,
      staff.cookie,
      body(bookable, [{ label: '8B', gender: 'MALE' }]),
    );
    expect([late.status, code(late)]).toEqual([409, 'SALES_CLOSED']);
    const map = (await seatMap(companyId, bookable.trip.tripId, staff.cookie).expect(200))
      .body as SeatMapBody;
    expect(map.salesOpen).toBe(false);
  });

  it('ist idempotent: Wiederholung ergibt dieselbe Buchung, andere Anfrage wird abgelehnt', async () => {
    const bookable = await createBookableTrip(t.prisma);
    const other = await createBookableTrip(t.prisma);
    const { companyId } = bookable.fixture;
    const staff = await staffSession(companyId);
    const otherStaff = await staffSession(other.fixture.companyId);
    const key = randomUUID();
    const sale = body(bookable, [{ label: '9A', gender: 'MALE' }]);

    const first = await sell(companyId, staff.cookie, sale, key).expect(201);
    const again = await sell(companyId, staff.cookie, sale, key).expect(200);
    expect((again.body as SaleBody).booking.id).toBe((first.body as SaleBody).booking.id);
    expect(await t.prisma.booking.count({ where: { tripId: bookable.trip.tripId } })).toBe(1);
    // Auch am Schalter steht nur der SHA-256 des Schlüssels in der Spalte (ADR 0020, ADR 0030).
    expect(await t.prisma.booking.count({ where: { idempotencyKey: key } })).toBe(0);
    expect(await t.prisma.booking.count({ where: { idempotencyKey: hashSecret(key) } })).toBe(1);

    const changed = await sell(
      companyId,
      staff.cookie,
      body(bookable, [{ label: '9B', gender: 'MALE' }]),
      key,
    );
    expect([changed.status, code(changed)]).toEqual([409, 'IDEMPOTENCY_KEY_REUSED']);
    // Derselbe Schlüssel online öffnet kein Verwaltungstoken für die Schalterbuchung.
    const online = await postBooking(t, sale, key);
    expect([online.status, code(online)]).toEqual([409, 'IDEMPOTENCY_KEY_REUSED']);
    expect(JSON.stringify(online.body)).not.toContain('manageToken');
    // Eine andere Firma sieht über den Schlüssel nichts.
    const foreign = await sell(
      other.fixture.companyId,
      otherStaff.cookie,
      body(other, [{ label: '9A', gender: 'MALE' }]),
      key,
    );
    expect([foreign.status, code(foreign)]).toEqual([409, 'IDEMPOTENCY_KEY_REUSED']);
    // Ein Online-Schlüssel ergibt am Schalter keine Buchung.
    const onlineKey = randomUUID();
    await postBooking(t, body(bookable, [{ label: '9C', gender: 'MALE' }]), onlineKey).expect(201);
    const reuse = await sell(
      companyId,
      staff.cookie,
      body(bookable, [{ label: '9C', gender: 'MALE' }]),
      onlineKey,
    );
    expect([reuse.status, code(reuse)]).toEqual([409, 'IDEMPOTENCY_KEY_REUSED']);

    const missing = await sell(companyId, staff.cookie, sale, null);
    expect([missing.status, code(missing)]).toEqual([400, 'VALIDATION_FAILED']);
  });

  it('rechnet die Vorschau mit denselben Regeln, ohne zu schreiben', async () => {
    const bookable = await createBookableTrip(t.prisma, { trip: { onlineLabels: ['1A'] } });
    const { companyId } = bookable.fixture;
    const staff = await staffSession(companyId);
    const seat = (label: string) => bookable.trip.seatIdByLabel.get(label)!;
    const stops = bookable.trip.tripStopIds;
    const request = (seats: { seatId: string; gender?: string }[], from = 0, to = 3) => ({
      tripId: bookable.trip.tripId,
      fromStopId: stops[from],
      toStopId: stops[to],
      seats,
    });

    const res = await quote(
      companyId,
      staff.cookie,
      request([{ seatId: seat('2A') }, { seatId: seat('2B') }], 1, 3),
    ).expect(200);
    expect(res.body).toMatchObject({
      fare: { amountMinor: 40_000, currency: 'SYP' },
      total: { amountMinor: 80_000, currency: 'SYP' },
      seats: [{ label: '2A' }, { label: '2B' }],
    });
    expect(await t.prisma.booking.count({ where: { tripId: bookable.trip.tripId } })).toBe(0);

    await hold(t, bookable, { passengers: [{ label: '1A', gender: 'FEMALE' }] });
    const taken = await quote(companyId, staff.cookie, request([{ seatId: seat('1A') }]));
    expect([taken.status, code(taken)]).toEqual([409, 'SEAT_TAKEN']);
    // Ohne Geschlecht prüft die Vorschau die Regel nicht; mit Geschlecht schon.
    await quote(companyId, staff.cookie, request([{ seatId: seat('1B') }])).expect(200);
    const conflict = await quote(
      companyId,
      staff.cookie,
      request([{ seatId: seat('1B'), gender: 'MALE' }]),
    );
    expect([conflict.status, code(conflict)]).toEqual([409, 'GENDER_RULE_CONFLICT']);

    // Ein abgelaufener, noch nicht freigegebener Hold blockiert die Vorschau nicht.
    t.clock.advance(60 * MINUTE);
    await quote(companyId, staff.cookie, request([{ seatId: seat('1A') }])).expect(200);
    const map = (await seatMap(companyId, bookable.trip.tripId, staff.cookie).expect(200))
      .body as SeatMapBody;
    expect(map.seats.find((s) => s.label === '1A')?.state).toBe('FREE');
  });

  it('storniert über die vorhandene Aktion und gibt den Sitz frei', async () => {
    const bookable = await createBookableTrip(t.prisma);
    const { companyId } = bookable.fixture;
    const staff = await staffSession(companyId);
    const res = await sell(
      companyId,
      staff.cookie,
      body(bookable, [{ label: '10A', gender: 'MALE' }]),
    ).expect(201);
    const id = (res.body as SaleBody).booking.id;
    await t
      .http()
      .post(`/api/v1/companies/${companyId}/bookings/${id}/cancel`)
      .set('Cookie', staff.cookie)
      .send({ reason: 'PASSENGER_REQUEST' })
      .expect(200);
    expect(await bookingState(t.prisma, id)).toEqual({
      status: 'CANCELLED',
      occupations: 0,
      tickets: ['VOID'],
    });
    await sell(companyId, staff.cookie, body(bookable, [{ label: '10A', gender: 'MALE' }])).expect(
      201,
    );
    const ticket = await t
      .http()
      .get(`/api/v1/companies/${companyId}/bookings/${id}/ticket`)
      .set('Cookie', staff.cookie)
      .expect(200);
    expect(
      (ticket.body as { tickets: { qrToken: string | null }[] }).tickets.map((e) => e.qrToken),
    ).toEqual([null]);
  });

  it('lehnt zu viele Sitze in einer Buchung ab', async () => {
    const bookable = await createBookableTrip(t.prisma);
    const { companyId } = bookable.fixture;
    const staff = await staffSession(companyId);
    const labels = ['1A', '1B', '1C', '1D', '2A', '2B', '2C', '2D', '3A', '3B'];
    const res = await sell(
      companyId,
      staff.cookie,
      body(
        bookable,
        labels.map((label) => ({ label, gender: 'MALE' as const })),
      ),
    );
    expect([res.status, code(res)]).toEqual([400, 'TOO_MANY_SEATS']);
  });

  it('erlaubt Admin und Agent, nicht Fahrer', async () => {
    const bookable = await createBookableTrip(t.prisma);
    const { companyId } = bookable.fixture;
    const admin = await staffSession(companyId, 'ADMIN');
    const driver = await staffSession(companyId, 'DRIVER');
    const sale = await sell(
      companyId,
      admin.cookie,
      body(bookable, [{ label: '2C', gender: 'MALE' }]),
    ).expect(201);
    const id = (sale.body as SaleBody).booking.id;

    const forbidden = [
      await sell(companyId, driver.cookie, body(bookable, [{ label: '2D', gender: 'MALE' }])),
      await seatMap(companyId, bookable.trip.tripId, driver.cookie),
      await quote(companyId, driver.cookie, {
        tripId: bookable.trip.tripId,
        fromStopId: bookable.trip.tripStopIds[0],
        toStopId: bookable.trip.tripStopIds[3],
        seats: [{ seatId: bookable.trip.seatIdByLabel.get('2D') }],
      }),
      await t
        .http()
        .get(`/api/v1/companies/${companyId}/bookings/${id}/ticket`)
        .set('Cookie', driver.cookie),
    ];
    expect(forbidden.map((res) => [res.status, code(res)])).toEqual([
      [403, 'FORBIDDEN'],
      [403, 'FORBIDDEN'],
      [403, 'FORBIDDEN'],
      [403, 'FORBIDDEN'],
    ]);
    expect(await t.prisma.booking.count({ where: { tripId: bookable.trip.tripId } })).toBe(1);
  });

  it('trennt Firmen in beide Richtungen', async () => {
    const a = await createBookableTrip(t.prisma);
    const b = await createBookableTrip(t.prisma);
    const staffA = await staffSession(a.fixture.companyId);
    const staffB = await staffSession(b.fixture.companyId);
    const saleA = (
      await sell(
        a.fixture.companyId,
        staffA.cookie,
        body(a, [{ label: '3C', gender: 'MALE' }]),
      ).expect(201)
    ).body as SaleBody;
    const saleB = (
      await sell(
        b.fixture.companyId,
        staffB.cookie,
        body(b, [{ label: '3C', gender: 'MALE' }]),
      ).expect(201)
    ).body as SaleBody;

    for (const [own, foreign, cookie, foreignSale] of [
      [a, b, staffA.cookie, saleB],
      [b, a, staffB.cookie, saleA],
    ] as const) {
      const ownId = own.fixture.companyId;
      // Fremde Fahrt unter der eigenen Firma: unbekannt, kein Verkauf.
      const foreignTrip = await sell(
        ownId,
        cookie,
        body(foreign, [{ label: '3D', gender: 'MALE' }]),
      );
      expect([foreignTrip.status, code(foreignTrip)]).toEqual([404, 'TRIP_NOT_FOUND']);
      const map = await seatMap(ownId, foreign.trip.tripId, cookie);
      expect([map.status, code(map)]).toEqual([404, 'TRIP_NOT_FOUND']);
      const q = await quote(ownId, cookie, {
        tripId: foreign.trip.tripId,
        fromStopId: foreign.trip.tripStopIds[0],
        toStopId: foreign.trip.tripStopIds[3],
        seats: [{ seatId: foreign.trip.seatIdByLabel.get('3D') }],
      });
      expect([q.status, code(q)]).toEqual([404, 'TRIP_NOT_FOUND']);
      const ticket = await t
        .http()
        .get(`/api/v1/companies/${ownId}/bookings/${foreignSale.booking.id}/ticket`)
        .set('Cookie', cookie);
      expect([ticket.status, code(ticket)]).toEqual([404, 'BOOKING_NOT_FOUND']);
      // Fremde Firma im Pfad: verboten.
      const path = await sell(
        foreign.fixture.companyId,
        cookie,
        body(foreign, [{ label: '3D', gender: 'MALE' }]),
      );
      expect([path.status, code(path)]).toEqual([403, 'FORBIDDEN']);
      const pathMap = await seatMap(foreign.fixture.companyId, foreign.trip.tripId, cookie);
      expect([pathMap.status, code(pathMap)]).toEqual([403, 'FORBIDDEN']);
    }
    expect(await t.prisma.booking.count({ where: { tripId: a.trip.tripId } })).toBe(1);
    expect(await t.prisma.booking.count({ where: { tripId: b.trip.tripId } })).toBe(1);
  });
});
