import { randomUUID } from 'node:crypto';

import { formatBookingCode } from '@masar/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { BookingExpiryJob } from '../src/modules/bookings/booking-expiry.job.js';
import {
  type CreateBookingInput,
  createBookingSchema,
} from '../src/modules/bookings/bookings.schemas.js';
import { BookingsService } from '../src/modules/bookings/bookings.service.js';
import { hashSecret } from '../src/modules/bookings/domain/secrets.js';
import { NationalIdCipher } from '../src/modules/bookings/national-id.cipher.js';
import { OutboxWorker } from '../src/modules/outbox/outbox.worker.js';
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
  guestPost,
  hold,
  nextPhone,
  postBooking,
} from './helpers/bookings.js';

/**
 * Buchungskern gegen PostgreSQL (Schritt 1.3): Hold, Barreservierung, Bestätigung mit Tickets,
 * Storno, Ablauf, Outbox, Fehlerpfade und Mandantentrennung. Nebenläufigkeit steht in
 * `bookings-concurrency.e2e.test.ts`, die Log-Ausgabe in `bookings-logging.e2e.test.ts`.
 */

const MINUTE = 60_000;

interface BookingBody {
  id: string;
  bookingCode: string;
  status: string;
  paymentMethod: string | null;
  holdExpiresAt: string | null;
  deadlineAt: string | null;
  fare: { amountMinor: number; currency: string };
  total: { amountMinor: number; currency: string };
  contact: { name: string; phone: string; email: string | null };
  passengers: {
    id: string;
    seatLabel: string;
    gender: string | null;
    nationalIdLast4: string | null;
  }[];
  tickets: { id: string; passengerId: string; seatLabel: string; status: string }[];
  confirmedAt: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
}

describe('Buchungskern (Integration)', () => {
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
    // Jeder Test beginnt bei der echten Zeit; Fahrten entstehen relativ zu Date.now().
    t.clock.advance(Date.now() - t.clock.now().getTime());
  });

  async function staffSession(
    companyId: string,
    role: 'ADMIN' | 'AGENT' | 'DRIVER' = 'AGENT',
  ): Promise<string> {
    const email = `staff-${randomUUID()}@firma.example`;
    await createStaff(t.prisma, {
      email,
      password: PASSWORD,
      memberships: [{ companyId, role }],
    });
    return loginAs(t, email);
  }

  async function auditActions(bookingId: string): Promise<string[]> {
    const entries = await t.prisma.auditLog.findMany({
      where: { entityType: 'booking', entityId: bookingId },
      orderBy: { occurredAt: 'asc' },
      select: { action: true },
    });
    return entries.map((entry) => entry.action);
  }

  async function outboxTypes(bookingId: string): Promise<string[]> {
    const entries = await t.prisma.outbox.findMany({
      where: { aggregateId: bookingId },
      orderBy: { createdAt: 'asc' },
      select: { type: true },
    });
    return entries.map((entry) => entry.type);
  }

  describe('Hold (POST /bookings)', () => {
    let bookable: BookableTrip;

    beforeAll(async () => {
      bookable = await createBookableTrip(t.prisma);
    });

    it('hält Sitze: Buchung HELD, Fahrgäste, Belegungen, Audit und Outbox in einer Transaktion', async () => {
      const body = bookingBody(bookable, {
        passengers: [
          { label: '2A', gender: 'FEMALE' },
          { label: '2B', gender: 'MALE', fullName: 'Omar Haddad' },
        ],
        from: 1,
        to: 3,
        email: ' Lina@Example.COM ',
      });
      const res = await postBooking(t, body);
      expect(res.status).toBe(201);
      const { booking, manageToken } = res.body as { booking: BookingBody; manageToken: string };
      expect(booking.status).toBe('HELD');
      expect(booking.bookingCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
      expect(manageToken).toMatch(/^[A-Za-z0-9_-]{22}$/);
      // Gemischtes Paar in einer Buchung: Ausnahme der Geschlechtsregel (ADR 0006).
      expect(booking.passengers.map((p) => p.seatLabel)).toEqual(['2A', '2B']);
      // Tarif 1→3 (40 000) mal zwei Fahrgäste.
      expect(booking.fare).toEqual({ amountMinor: 40_000, currency: 'SYP' });
      expect(booking.total).toEqual({ amountMinor: 80_000, currency: 'SYP' });
      expect(booking.contact.email).toBe('lina@example.com');
      expect(booking.tickets).toEqual([]);
      expect(
        new Date(booking.holdExpiresAt!).getTime() - t.clock.now().getTime(),
      ).toBeLessThanOrEqual(15 * MINUTE);

      const stored = await t.prisma.booking.findUniqueOrThrow({
        where: { id: booking.id },
        select: {
          fromSeq: true,
          toSeq: true,
          manageTokenHash: true,
          channel: true,
          occupations: { select: { fromSeq: true, toSeq: true, gender: true } },
        },
      });
      expect(stored).toMatchObject({ fromSeq: 1, toSeq: 3, channel: 'ONLINE' });
      expect(stored.manageTokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(stored.manageTokenHash).not.toContain(manageToken);
      expect(stored.occupations).toHaveLength(2);
      expect(stored.occupations.every((o) => o.fromSeq === 1 && o.toSeq === 3)).toBe(true);
      expect(await auditActions(booking.id)).toEqual(['BOOKING_HELD']);
      expect(await outboxTypes(booking.id)).toEqual(['BOOKING_HELD']);
      const audit = await t.prisma.auditLog.findFirstOrThrow({
        where: { entityId: booking.id },
        select: { actorType: true, data: true, companyId: true },
      });
      expect(audit.actorType).toBe('GUEST');
      expect(audit.companyId).toBe(bookable.fixture.companyId);
      expect(JSON.stringify(audit.data)).not.toMatch(/Lina|Omar|\+963|example\.com/);
    });

    it('zeigt die Buchung nur mit dem Verwaltungstoken, sonst dieselbe 404', async () => {
      const held = await hold(t, bookable, { passengers: [{ label: '3A', gender: 'FEMALE' }] });
      const ok = await t
        .http()
        .get(`/api/v1/bookings/${held.id}`)
        .set('X-Manage-Token', held.manageToken)
        .expect(200);
      expect((ok.body as BookingBody).bookingCode).toBe(held.bookingCode);

      const wrong = await t
        .http()
        .get(`/api/v1/bookings/${held.id}`)
        .set('X-Manage-Token', `${held.manageToken.slice(0, -2)}xx`);
      const missing = await t.http().get(`/api/v1/bookings/${held.id}`);
      const unknown = await t
        .http()
        .get(`/api/v1/bookings/${randomUUID()}`)
        .set('X-Manage-Token', held.manageToken);
      for (const res of [wrong, missing, unknown]) {
        expect(res.status).toBe(404);
        expect(res.body).toMatchObject({ code: 'BOOKING_NOT_FOUND' });
      }
    });

    it('liefert bei Wiederholung mit demselben Idempotency-Key dieselbe Buchung und ein neues Token', async () => {
      const key = randomUUID();
      const body = bookingBody(bookable, { passengers: [{ label: '4A', gender: 'MALE' }] });
      const first = await postBooking(t, body, key).expect(201);
      const second = await postBooking(t, body, key).expect(200);
      const a = first.body as { booking: BookingBody; manageToken: string };
      const b = second.body as { booking: BookingBody; manageToken: string };
      expect(b.booking.id).toBe(a.booking.id);
      expect(b.manageToken).not.toBe(a.manageToken);
      // In der Spalte steht nur der SHA-256 des Schlüssels, nie der gesendete Wert (ADR 0020).
      expect(await t.prisma.booking.count({ where: { idempotencyKey: key } })).toBe(0);
      expect(await t.prisma.booking.count({ where: { idempotencyKey: hashSecret(key) } })).toBe(1);
      // Nur das neueste Token gilt.
      await t
        .http()
        .get(`/api/v1/bookings/${a.booking.id}`)
        .set('X-Manage-Token', a.manageToken)
        .expect(404);
      await t
        .http()
        .get(`/api/v1/bookings/${a.booking.id}`)
        .set('X-Manage-Token', b.manageToken)
        .expect(200);

      const other = bookingBody(bookable, { passengers: [{ label: '4B', gender: 'MALE' }] });
      const reused = await postBooking(t, other, key);
      expect(reused.status).toBe(409);
      expect(reused.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    });

    it('verlangt den Header Idempotency-Key', async () => {
      const body = bookingBody(bookable, { passengers: [{ label: '5A', gender: 'MALE' }] });
      const res = await t.http().post('/api/v1/bookings').send(body);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        code: 'VALIDATION_FAILED',
        errors: [{ path: 'headers.idempotency-key', rule: 'invalid_type' }],
      });
      const short = await postBooking(t, body, 'kurz');
      expect(short.body).toMatchObject({
        errors: [{ path: 'headers.idempotency-key', rule: 'invalid_format' }],
      });
    });

    it('prüft Telefon, doppelte Sitze und Pflichtfelder im Schema', async () => {
      const bad = bookingBody(bookable, {
        passengers: [{ label: '5A', gender: 'MALE' }],
        phone: '123',
      });
      expect((await postBooking(t, bad)).body).toMatchObject({
        code: 'VALIDATION_FAILED',
        errors: [{ path: 'contact.phone', rule: 'custom' }],
      });
      const duplicate = bookingBody(bookable, {
        passengers: [
          { label: '5A', gender: 'MALE' },
          { label: '5A', gender: 'MALE' },
        ],
      });
      expect((await postBooking(t, duplicate)).body).toMatchObject({
        code: 'VALIDATION_FAILED',
        errors: [{ path: 'passengers', rule: 'custom' }],
      });
    });

    it('normalisiert die Telefonnummer auf E.164', async () => {
      const held = await hold(t, bookable, {
        passengers: [{ label: '5C', gender: 'MALE' }],
        phone: '0933 777 001',
      });
      const stored = await t.prisma.booking.findUniqueOrThrow({
        where: { id: held.id },
        select: { contactPhoneE164: true },
      });
      expect(stored.contactPhoneE164).toBe('+963933777001');
    });

    it('bildet Fahrt- und Teilstreckenfehler ab', async () => {
      const draft = await createBookableTrip(t.prisma, { trip: { status: 'DRAFT' } });
      const departed = await createBookableTrip(t.prisma, { trip: { status: 'DEPARTED' } });
      const closed = await createBookableTrip(t.prisma, {
        trip: { onlineSalesCloseAt: new Date(Date.now() - MINUTE) },
      });
      const noFare = await createBookableTrip(t.prisma, { fixture: { fares: { '0-1': 25_000 } } });
      const seat = [{ label: '1A', gender: 'MALE' as const }];
      const cases: [Record<string, unknown>, string][] = [
        [
          { ...bookingBody(bookable, { passengers: seat }), tripId: randomUUID() },
          'TRIP_NOT_FOUND',
        ],
        [bookingBody(draft, { passengers: seat }), 'TRIP_NOT_FOUND'],
        [bookingBody(departed, { passengers: seat }), 'TRIP_NOT_BOOKABLE'],
        [bookingBody(closed, { passengers: seat }), 'SALES_CLOSED'],
        [bookingBody(bookable, { passengers: seat, from: 2, to: 1 }), 'INVALID_SEGMENT'],
        [
          { ...bookingBody(bookable, { passengers: seat }), toStopId: noFare.trip.tripStopIds[3] },
          'INVALID_SEGMENT',
        ],
        [bookingBody(noFare, { passengers: seat, from: 0, to: 2 }), 'NO_FARE_FOR_SEGMENT'],
      ];
      for (const [body, code] of cases) {
        const res = await postBooking(t, body);
        expect(`${res.status} ${(res.body as { code: string }).code}`).toMatch(
          new RegExp(` ${code}$`),
        );
      }
    });

    it('prüft Kontingent und Sperre: SEAT_UNKNOWN, SEAT_BLOCKED, SEAT_NOT_ONLINE', async () => {
      const quota = await createBookableTrip(t.prisma, {
        trip: { onlineLabels: ['1A', '1B', '9B'], blockedLabels: ['9B'] },
      });
      const foreign = await createBookableTrip(t.prisma);
      const unknown = await postBooking(
        t,
        bookingBody(quota, {
          passengers: [{ label: foreign.trip.seatIdByLabel.get('1A')!, gender: 'MALE' }],
        }),
      );
      expect(unknown.status).toBe(400);
      expect(unknown.body).toMatchObject({ code: 'SEAT_UNKNOWN' });
      const blocked = await postBooking(
        t,
        bookingBody(quota, { passengers: [{ label: '9B', gender: 'MALE' }] }),
      );
      expect(blocked.body).toMatchObject({ code: 'SEAT_BLOCKED', params: { seats: ['9B'] } });
      const offline = await postBooking(
        t,
        bookingBody(quota, { passengers: [{ label: '9A', gender: 'MALE' }] }),
      );
      expect(offline.status).toBe(409);
      expect(offline.body).toMatchObject({ code: 'SEAT_NOT_ONLINE', params: { seats: ['9A'] } });
    });

    it('lehnt belegte Sitze auf überlappenden Teilstrecken ab und vergibt sie am Halt neu', async () => {
      await hold(t, bookable, { passengers: [{ label: '6A', gender: 'MALE' }], from: 0, to: 2 });
      const overlap = await postBooking(
        t,
        bookingBody(bookable, { passengers: [{ label: '6A', gender: 'MALE' }], from: 1, to: 3 }),
      );
      expect(overlap.status).toBe(409);
      expect(overlap.body).toMatchObject({ code: 'SEAT_TAKEN', params: { seats: ['6A'] } });
      // [0,2) und [2,4) überlappen nicht: derselbe Sitz ab dem Halt 2.
      await hold(t, bookable, { passengers: [{ label: '6A', gender: 'MALE' }], from: 2, to: 3 });
    });

    it('setzt die Geschlechtsregel durch, mit Pflichtangabe und Ausnahme derselben Buchung', async () => {
      await hold(t, bookable, { passengers: [{ label: '7A', gender: 'MALE' }], from: 0, to: 2 });
      const conflict = await postBooking(
        t,
        bookingBody(bookable, { passengers: [{ label: '7B', gender: 'FEMALE' }], from: 1, to: 3 }),
      );
      expect(conflict.status).toBe(409);
      expect(conflict.body).toMatchObject({
        code: 'GENDER_RULE_CONFLICT',
        params: { seats: ['7B'] },
      });
      // Ohne Überlappung kein Konflikt.
      await hold(t, bookable, { passengers: [{ label: '7B', gender: 'FEMALE' }], from: 2, to: 3 });

      const missing = await postBooking(
        t,
        bookingBody(bookable, { passengers: [{ label: '8A' }] }),
      );
      expect(missing.status).toBe(400);
      expect(missing.body).toMatchObject({ code: 'GENDER_REQUIRED' });

      // Regel aus: Geschlecht freiwillig, Nachbarschaft egal.
      const relaxed = await createBookableTrip(t.prisma, { trip: { genderRuleEnabled: false } });
      await hold(t, relaxed, { passengers: [{ label: '1A', gender: 'MALE' }] });
      await hold(t, relaxed, { passengers: [{ label: '1B' }] });
    });

    it('zählt eine Belegung ohne Geschlechtsangabe als Konflikt', async () => {
      // Eine Fahrt, die die Regel erst nachträglich aktiviert, hat Belegungen ohne Geschlecht.
      const later = await createBookableTrip(t.prisma, { trip: { genderRuleEnabled: false } });
      await hold(t, later, { passengers: [{ label: '1A' }] });
      await t.prisma.trip.update({
        where: { id: later.trip.tripId },
        data: { genderRuleEnabled: true },
      });
      const res = await postBooking(
        t,
        bookingBody(later, { passengers: [{ label: '1B', gender: 'MALE' }] }),
      );
      expect(res.body).toMatchObject({ code: 'GENDER_RULE_CONFLICT' });
    });

    it('begrenzt Sitze je Buchung und offene Buchungen je Telefonnummer', async () => {
      const labels = ['1A', '1B', '1C', '1D', '2C', '2D', '3C', '3D', '4C', '4D'];
      const tooMany = await postBooking(
        t,
        bookingBody(bookable, {
          passengers: labels.map((label) => ({ label, gender: 'MALE' as const })),
        }),
      );
      expect(tooMany.status).toBe(400);
      expect(tooMany.body).toMatchObject({ code: 'TOO_MANY_SEATS', params: { max: 9 } });

      const phone = nextPhone();
      for (const label of ['10A', '10B', '10C']) {
        await hold(t, bookable, { passengers: [{ label, gender: 'MALE' }], phone });
      }
      const fourth = await postBooking(
        t,
        bookingBody(bookable, { passengers: [{ label: '10D', gender: 'MALE' }], phone }),
      );
      expect(fourth.status).toBe(409);
      expect(fourth.body).toMatchObject({ code: 'TOO_MANY_OPEN_HOLDS' });
    });

    it('würfelt den Buchungscode bei Kollision neu', async () => {
      const service = t.app.get(BookingsService);
      const taken = await hold(t, bookable, { passengers: [{ label: '11A', gender: 'MALE' }] });
      const takenBytes = codeBytes(taken.bookingCode);
      let calls = 0;
      service.random = (size) => {
        calls += 1;
        return calls === 1 ? takenBytes : new Uint8Array(size).fill(calls);
      };
      try {
        const held = await hold(t, bookable, { passengers: [{ label: '11B', gender: 'MALE' }] });
        expect(held.bookingCode).not.toBe(taken.bookingCode);
        expect(calls).toBe(2);
      } finally {
        service.random = undefined;
      }
    });
  });

  describe('Ausweisnummer', () => {
    it('verschlüsselt sie, wenn die Firma sie verlangt, und speichert nur die letzten vier Zeichen im Klartext', async () => {
      const strict = await createBookableTrip(t.prisma, { company: { requireNationalId: true } });
      const missing = await postBooking(
        t,
        bookingBody(strict, { passengers: [{ label: '1A', gender: 'MALE' }] }),
      );
      expect(missing.status).toBe(400);
      expect(missing.body).toMatchObject({ code: 'NATIONAL_ID_REQUIRED' });

      const held = await hold(t, strict, {
        passengers: [{ label: '1A', gender: 'MALE', nationalId: '010 203 04050' }],
      });
      const passenger = await t.prisma.bookingPassenger.findFirstOrThrow({
        where: { bookingId: held.id },
        select: {
          id: true,
          nationalIdEncrypted: true,
          nationalIdKeyId: true,
          nationalIdLast4: true,
        },
      });
      expect(passenger.nationalIdLast4).toBe('4050');
      expect(passenger.nationalIdKeyId).toBe('test-2026');
      const ciphertext = Buffer.from(passenger.nationalIdEncrypted!);
      expect(ciphertext.toString('latin1')).not.toContain('01020304050');
      const cipher = t.app.get(NationalIdCipher);
      expect(cipher.decrypt({ ciphertext, keyId: passenger.nationalIdKeyId! }, passenger.id)).toBe(
        '01020304050',
      );
    });

    it('verwirft sie, wenn die Firma sie nicht verlangt', async () => {
      const relaxed = await createBookableTrip(t.prisma);
      const held = await hold(t, relaxed, {
        passengers: [{ label: '1A', gender: 'MALE', nationalId: '01020304050' }],
      });
      const passenger = await t.prisma.bookingPassenger.findFirstOrThrow({
        where: { bookingId: held.id },
        select: { nationalIdEncrypted: true, nationalIdLast4: true },
      });
      expect(passenger).toEqual({ nationalIdEncrypted: null, nationalIdLast4: null });
    });

    it('nimmt ohne Schlüssel keine Buchung an, wenn die Firma die Nummer verlangt', async () => {
      const strict = await createBookableTrip(t.prisma, { company: { requireNationalId: true } });
      const cipher = t.app.get(NationalIdCipher);
      const keys = cipher as unknown as { keys: Map<string, Buffer>; activeKeyId?: string };
      const active = keys.activeKeyId;
      keys.activeKeyId = undefined;
      try {
        const res = await postBooking(
          t,
          bookingBody(strict, {
            passengers: [{ label: '1A', gender: 'MALE', nationalId: '12345678' }],
          }),
        );
        expect(res.status).toBe(503);
        expect(res.body).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
        expect(res.headers['retry-after']).toBe('60');
      } finally {
        keys.activeKeyId = active;
      }
    });
  });

  describe('Barreservierung (POST /bookings/:id/reserve-cash)', () => {
    it('setzt HELD → RESERVED mit der Barfrist der Fahrt; Wiederholung ändert nichts', async () => {
      const bookable = await createBookableTrip(t.prisma);
      const held = await hold(t, bookable, { passengers: [{ label: '1A', gender: 'MALE' }] });
      const res = await guestPost(t, held, 'reserve-cash').expect(200);
      const booking = res.body as BookingBody;
      expect(booking.status).toBe('RESERVED');
      expect(booking.paymentMethod).toBe('CASH');
      // Standard der Firma: 120 Minuten vor der Abfahrt.
      expect(booking.deadlineAt).toBe(
        new Date(bookable.departureAt.getTime() - 120 * MINUTE).toISOString(),
      );
      const again = await guestPost(t, held, 'reserve-cash').expect(200);
      expect((again.body as BookingBody).deadlineAt).toBe(booking.deadlineAt);
      expect(await auditActions(held.id)).toEqual(['BOOKING_HELD', 'BOOKING_RESERVED_CASH']);
      expect(await outboxTypes(held.id)).toEqual(['BOOKING_HELD', 'BOOKING_RESERVED']);
      expect((await bookingState(t.prisma, held.id)).occupations).toBe(1);
    });

    it('nimmt die Barfrist der Fahrt, wenn sie gesetzt ist', async () => {
      const departureAt = new Date(Date.now() + 3 * 24 * 3_600_000);
      const cashDeadlineAt = new Date(departureAt.getTime() - 45 * MINUTE);
      const bookable = await createBookableTrip(t.prisma, {
        trip: { departureAt },
        cashDeadlineAt,
      });
      const held = await hold(t, bookable, { passengers: [{ label: '1A', gender: 'MALE' }] });
      const res = await guestPost(t, held, 'reserve-cash').expect(200);
      expect((res.body as BookingBody).deadlineAt).toBe(cashDeadlineAt.toISOString());
    });

    it('lehnt ab, wenn die Barfrist schon vorbei ist', async () => {
      // Abfahrt in 90 Minuten, Barfrist 120 Minuten davor: liegt in der Vergangenheit.
      const bookable = await createBookableTrip(t.prisma, {
        trip: { departureAt: new Date(Date.now() + 90 * MINUTE) },
      });
      const held = await hold(t, bookable, { passengers: [{ label: '1A', gender: 'MALE' }] });
      const res = await guestPost(t, held, 'reserve-cash');
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'CASH_DEADLINE_PASSED' });
      expect((await bookingState(t.prisma, held.id)).status).toBe('HELD');
    });

    it('meldet HOLD_EXPIRED nach Ablauf des Holds und gibt den Sitz in derselben Transaktion frei', async () => {
      const bookable = await createBookableTrip(t.prisma);
      const held = await hold(t, bookable, { passengers: [{ label: '1A', gender: 'MALE' }] });
      t.clock.advance(16 * MINUTE);
      const res = await guestPost(t, held, 'reserve-cash');
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'HOLD_EXPIRED' });
      expect(await bookingState(t.prisma, held.id)).toEqual({
        status: 'EXPIRED',
        occupations: 0,
        tickets: [],
      });
      expect(await auditActions(held.id)).toEqual(['BOOKING_HELD', 'BOOKING_EXPIRED']);
    });

    it('verlangt das Verwaltungstoken', async () => {
      const bookable = await createBookableTrip(t.prisma);
      const held = await hold(t, bookable, { passengers: [{ label: '1A', gender: 'MALE' }] });
      const res = await guestPost(t, { ...held, manageToken: 'A'.repeat(22) }, 'reserve-cash');
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ code: 'BOOKING_NOT_FOUND' });
      expect((await bookingState(t.prisma, held.id)).status).toBe('HELD');
    });
  });

  describe('Bestätigung und Storno durch die Firma', () => {
    let bookable: BookableTrip;
    let agent: string;

    beforeAll(async () => {
      bookable = await createBookableTrip(t.prisma, {
        commissionRateBps: 300,
        policy: {
          rules: [
            { minMinutesBeforeDeparture: 24 * 60, feeBps: 0 },
            { minMinutesBeforeDeparture: 120, feeBps: 2_500 },
          ],
        },
      });
      agent = await staffSession(bookable.fixture.companyId);
    });

    async function reserved(
      labels: string[],
      email?: string,
    ): Promise<{ id: string; bookingCode: string; manageToken: string }> {
      const held = await hold(t, bookable, {
        passengers: labels.map((label) => ({ label, gender: 'MALE' as const })),
        ...(email === undefined ? {} : { email }),
      });
      await guestPost(t, held, 'reserve-cash').expect(200);
      return held;
    }

    function confirm(bookingId: string, cookie = agent, companyId = bookable.fixture.companyId) {
      return t
        .http()
        .post(`/api/v1/companies/${companyId}/bookings/${bookingId}/confirm-cash`)
        .set('Cookie', cookie);
    }

    it('findet die Buchung über den Code, auch klein geschrieben und mit Bindestrich', async () => {
      const booking = await reserved(['1A']);
      const code = formatBookingCode(booking.bookingCode).toLowerCase();
      const res = await t
        .http()
        .post(`/api/v1/companies/${bookable.fixture.companyId}/bookings/lookup`)
        .set('Cookie', agent)
        .send({ bookingCode: code })
        .expect(200);
      expect((res.body as BookingBody).id).toBe(booking.id);
    });

    it('bestätigt bar: CONFIRMED, Tickets mit Token-Hash, Provision eingefroren, einmalig', async () => {
      const booking = await reserved(['2A', '2B']);
      const res = await confirm(booking.id).expect(200);
      const body = res.body as BookingBody;
      expect(body.status).toBe('CONFIRMED');
      expect(body.confirmedAt).not.toBeNull();
      expect(body.tickets.map((ticket) => [ticket.seatLabel, ticket.status])).toEqual([
        ['2A', 'ISSUED'],
        ['2B', 'ISSUED'],
      ]);
      expect(JSON.stringify(body)).not.toMatch(/qrToken/i);

      const stored = await t.prisma.booking.findUniqueOrThrow({
        where: { id: booking.id },
        select: {
          commissionRateBps: true,
          commissionAmountMinor: true,
          totalAmountMinor: true,
          tickets: { select: { qrTokenHash: true, companyId: true } },
        },
      });
      expect(stored.totalAmountMinor).toBe(120_000);
      expect(stored.commissionRateBps).toBe(300);
      expect(stored.commissionAmountMinor).toBe(3_600);
      expect(stored.tickets.every((ticket) => /^[0-9a-f]{64}$/.test(ticket.qrTokenHash))).toBe(
        true,
      );
      expect(new Set(stored.tickets.map((ticket) => ticket.qrTokenHash)).size).toBe(2);

      // Zweiter Klick: No-op, keine weiteren Tickets.
      await confirm(booking.id).expect(200);
      expect(await t.prisma.ticket.count({ where: { bookingId: booking.id } })).toBe(2);
      expect(await auditActions(booking.id)).toEqual([
        'BOOKING_HELD',
        'BOOKING_RESERVED_CASH',
        'BOOKING_CONFIRMED_CASH',
      ]);
      const audit = await t.prisma.auditLog.findFirstOrThrow({
        where: { entityId: booking.id, action: 'BOOKING_CONFIRMED_CASH' },
        select: { actorType: true, actorId: true },
      });
      expect(audit.actorType).toBe('USER');
      expect(audit.actorId).not.toBeNull();
      expect(await outboxTypes(booking.id)).toContain('BOOKING_CONFIRMED');
    });

    it('friert 0 bps ein, wenn kein Provisionssatz gilt', async () => {
      const bare = await createBookableTrip(t.prisma);
      const cookie = await staffSession(bare.fixture.companyId, 'ADMIN');
      const held = await hold(t, bare, { passengers: [{ label: '1A', gender: 'MALE' }] });
      await guestPost(t, held, 'reserve-cash').expect(200);
      await confirm(held.id, cookie, bare.fixture.companyId).expect(200);
      const stored = await t.prisma.booking.findUniqueOrThrow({
        where: { id: held.id },
        select: { commissionRateBps: true, commissionAmountMinor: true },
      });
      expect(stored).toEqual({ commissionRateBps: 0, commissionAmountMinor: 0 });
    });

    it('bestätigt keinen Hold und keine abgelaufene Barreservierung', async () => {
      const held = await hold(t, bookable, { passengers: [{ label: '3A', gender: 'MALE' }] });
      const res = await confirm(held.id);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'INVALID_STATE_TRANSITION' });

      const late = await createBookableTrip(t.prisma, {
        trip: { departureAt: new Date(Date.now() + 4 * 3_600_000) },
      });
      const cookie = await staffSession(late.fixture.companyId);
      const booking = await hold(t, late, { passengers: [{ label: '1A', gender: 'MALE' }] });
      await guestPost(t, booking, 'reserve-cash').expect(200);
      // Barfrist: 2 Stunden vor Abfahrt, also in 2 Stunden.
      t.clock.advance(2 * 3_600_000 + MINUTE);
      const expired = await confirm(booking.id, cookie, late.fixture.companyId);
      expect(expired.status).toBe(409);
      expect(expired.body).toMatchObject({ code: 'HOLD_EXPIRED' });
      expect(await bookingState(t.prisma, booking.id)).toMatchObject({
        status: 'EXPIRED',
        occupations: 0,
      });
    });

    it('trennt Mandanten: fremde Firma 403, fremde Buchung im eigenen Pfad 404, Fahrer 403', async () => {
      const booking = await reserved(['4A']);
      const other = await createBookableTrip(t.prisma);
      const foreignAgent = await staffSession(other.fixture.companyId);

      const forbidden = await confirm(booking.id, foreignAgent);
      expect(forbidden.status).toBe(403);
      expect(forbidden.body).toMatchObject({ code: 'FORBIDDEN' });

      const notFound = await confirm(booking.id, foreignAgent, other.fixture.companyId);
      expect(notFound.status).toBe(404);
      expect(notFound.body).toMatchObject({ code: 'BOOKING_NOT_FOUND' });
      const lookup = await t
        .http()
        .post(`/api/v1/companies/${other.fixture.companyId}/bookings/lookup`)
        .set('Cookie', foreignAgent)
        .send({ bookingCode: booking.bookingCode });
      expect(lookup.status).toBe(404);

      const driver = await staffSession(bookable.fixture.companyId, 'DRIVER');
      expect((await confirm(booking.id, driver)).status).toBe(403);
      expect((await bookingState(t.prisma, booking.id)).status).toBe('RESERVED');
    });

    it('storniert durch die Firma: Belegung weg, Tickets VOID, Grund als Code', async () => {
      const booking = await reserved(['5A', '5B']);
      await confirm(booking.id).expect(200);
      const res = await t
        .http()
        .post(`/api/v1/companies/${bookable.fixture.companyId}/bookings/${booking.id}/cancel`)
        .set('Cookie', agent)
        .send({ reason: 'OPERATIONAL' })
        .expect(200);
      expect(res.body).toMatchObject({ status: 'CANCELLED', cancelledBy: 'COMPANY' });
      expect(await bookingState(t.prisma, booking.id)).toEqual({
        status: 'CANCELLED',
        occupations: 0,
        tickets: ['VOID', 'VOID'],
      });
      const stored = await t.prisma.booking.findUniqueOrThrow({
        where: { id: booking.id },
        select: {
          cancelReason: true,
          cancelledByUserId: true,
          passengers: { select: { status: true } },
        },
      });
      expect(stored.cancelReason).toBe('OPERATIONAL');
      expect(stored.cancelledByUserId).not.toBeNull();
      expect(stored.passengers.every((p) => p.status === 'CANCELLED')).toBe(true);
      // Der Sitz ist sofort wieder buchbar.
      await hold(t, bookable, { passengers: [{ label: '5A', gender: 'MALE' }] });

      const freeText = await t
        .http()
        .post(`/api/v1/companies/${bookable.fixture.companyId}/bookings/${booking.id}/cancel`)
        .set('Cookie', agent)
        .send({ reason: 'Fahrgast Ahmad hat angerufen' });
      expect(freeText.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('lehnt Storno nach Check-in ab', async () => {
      const booking = await reserved(['6A']);
      await confirm(booking.id).expect(200);
      await t.prisma.ticket.updateMany({
        where: { bookingId: booking.id },
        data: { status: 'CHECKED_IN', checkedInAt: new Date() },
      });
      const res = await t
        .http()
        .post(`/api/v1/companies/${bookable.fixture.companyId}/bookings/${booking.id}/cancel`)
        .set('Cookie', agent)
        .send({ reason: 'OTHER' });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'BOOKING_NOT_CANCELLABLE' });
      expect((await bookingState(t.prisma, booking.id)).occupations).toBe(1);
    });
  });

  describe('Storno durch den Fahrgast', () => {
    it('gibt einen Hold frei und löscht die Belegung in derselben Transaktion; Wiederholung ist No-op', async () => {
      const bookable = await createBookableTrip(t.prisma, {
        policy: { allowPassengerCancel: false },
      });
      const held = await hold(t, bookable, { passengers: [{ label: '1A', gender: 'MALE' }] });
      const res = await guestPost(t, held, 'cancel').expect(200);
      expect(res.body).toMatchObject({ status: 'CANCELLED', cancelledBy: 'PASSENGER' });
      expect(await bookingState(t.prisma, held.id)).toEqual({
        status: 'CANCELLED',
        occupations: 0,
        tickets: [],
      });
      await guestPost(t, held, 'cancel').expect(200);
      expect(await auditActions(held.id)).toEqual([
        'BOOKING_HELD',
        'BOOKING_CANCELLED_BY_PASSENGER',
      ]);
      // Nach dem Storno sofort wieder frei.
      await hold(t, bookable, { passengers: [{ label: '1A', gender: 'MALE' }] });
    });

    it('storniert eine bestätigte Buchung nach der Stornoregel mit Gebühr im Audit-Log', async () => {
      const bookable = await createBookableTrip(t.prisma, {
        trip: { departureAt: new Date(Date.now() + 5 * 3_600_000) },
        policy: {
          rules: [
            { minMinutesBeforeDeparture: 24 * 60, feeBps: 0 },
            { minMinutesBeforeDeparture: 60, feeBps: 2_500 },
          ],
        },
      });
      const cookie = await staffSession(bookable.fixture.companyId);
      const held = await hold(t, bookable, { passengers: [{ label: '1A', gender: 'MALE' }] });
      await guestPost(t, held, 'reserve-cash').expect(200);
      await t
        .http()
        .post(`/api/v1/companies/${bookable.fixture.companyId}/bookings/${held.id}/confirm-cash`)
        .set('Cookie', cookie)
        .expect(200);
      await guestPost(t, held, 'cancel').expect(200);
      expect(await bookingState(t.prisma, held.id)).toEqual({
        status: 'CANCELLED',
        occupations: 0,
        tickets: ['VOID'],
      });
      const audit = await t.prisma.auditLog.findFirstOrThrow({
        where: { entityId: held.id, action: 'BOOKING_CANCELLED_BY_PASSENGER' },
        select: { data: true },
      });
      // Tarif 0→3 = 60 000, 25 % Gebühr.
      expect(audit.data).toMatchObject({ feeBps: 2_500, feeAmountMinor: 15_000, ticketsVoided: 1 });
    });

    it('lehnt ab, wenn die Regel Storno ausschließt oder die Frist vorbei ist', async () => {
      for (const options of [
        { policy: { allowPassengerCancel: false } },
        {
          trip: { departureAt: new Date(Date.now() + 5 * 3_600_000) },
          policy: { rules: [{ minMinutesBeforeDeparture: 24 * 60, feeBps: 0 }] },
        },
      ]) {
        const bookable = await createBookableTrip(t.prisma, options);
        const cookie = await staffSession(bookable.fixture.companyId);
        const held = await hold(t, bookable, { passengers: [{ label: '1A', gender: 'MALE' }] });
        await guestPost(t, held, 'reserve-cash').expect(200);
        await t
          .http()
          .post(`/api/v1/companies/${bookable.fixture.companyId}/bookings/${held.id}/confirm-cash`)
          .set('Cookie', cookie)
          .expect(200);
        const res = await guestPost(t, held, 'cancel');
        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({ code: 'BOOKING_NOT_CANCELLABLE' });
        expect(await bookingState(t.prisma, held.id)).toMatchObject({
          status: 'CONFIRMED',
          occupations: 1,
        });
      }
    });
  });

  describe('Ablauf', () => {
    it('setzt abgelaufene Holds und Barreservierungen per Job auf EXPIRED und löscht die Belegung', async () => {
      const bookable = await createBookableTrip(t.prisma, {
        trip: { departureAt: new Date(Date.now() + 3 * 3_600_000) },
      });
      const held = await hold(t, bookable, { passengers: [{ label: '1A', gender: 'MALE' }] });
      const cash = await hold(t, bookable, { passengers: [{ label: '1C', gender: 'MALE' }] });
      await guestPost(t, cash, 'reserve-cash').expect(200);
      const job = t.app.get(BookingExpiryJob);

      // Noch nichts abgelaufen (andere Tests können eigene Fahrten mitbringen).
      await job.runOnce();
      expect((await bookingState(t.prisma, held.id)).status).toBe('HELD');

      t.clock.advance(16 * MINUTE);
      await job.runOnce();
      expect(await bookingState(t.prisma, held.id)).toEqual({
        status: 'EXPIRED',
        occupations: 0,
        tickets: [],
      });
      expect((await bookingState(t.prisma, cash.id)).status).toBe('RESERVED');

      // Barfrist 2 Stunden vor Abfahrt, also in rund einer Stunde.
      t.clock.advance(60 * MINUTE);
      const result = await job.runOnce();
      expect(result.expired).toBeGreaterThanOrEqual(1);
      expect(await bookingState(t.prisma, cash.id)).toMatchObject({
        status: 'EXPIRED',
        occupations: 0,
      });
      const audit = await t.prisma.auditLog.findFirstOrThrow({
        where: { entityId: cash.id, action: 'BOOKING_EXPIRED' },
        select: { actorType: true, data: true },
      });
      expect(audit).toMatchObject({
        actorType: 'SYSTEM',
        data: { from: 'RESERVED', to: 'EXPIRED' },
      });
      expect(await outboxTypes(cash.id)).toEqual([
        'BOOKING_HELD',
        'BOOKING_RESERVED',
        'BOOKING_EXPIRED',
      ]);
      // Ein zweiter Lauf findet nichts mehr.
      await job.runOnce();
      expect(await auditActions(cash.id)).toEqual([
        'BOOKING_HELD',
        'BOOKING_RESERVED_CASH',
        'BOOKING_EXPIRED',
      ]);
    });

    it('gibt abgelaufene Holds der Fahrt bei der nächsten Reservierung frei, auch ohne Job', async () => {
      const bookable = await createBookableTrip(t.prisma);
      const old = await hold(t, bookable, { passengers: [{ label: '1A', gender: 'MALE' }] });
      t.clock.advance(16 * MINUTE);
      const fresh = await hold(t, bookable, { passengers: [{ label: '1A', gender: 'MALE' }] });
      expect(await bookingState(t.prisma, old.id)).toMatchObject({
        status: 'EXPIRED',
        occupations: 0,
      });
      expect(await bookingState(t.prisma, fresh.id)).toMatchObject({
        status: 'HELD',
        occupations: 1,
      });
    });

    it('hält die SQL-Regel des Ablaufs gleich mit isPastDeadline (Grenze inklusive)', async () => {
      const bookable = await createBookableTrip(t.prisma);
      const held = await hold(t, bookable, { passengers: [{ label: '2A', gender: 'MALE' }] });
      const stored = await t.prisma.booking.findUniqueOrThrow({
        where: { id: held.id },
        select: { holdExpiresAt: true },
      });
      const service = t.app.get(BookingsService);
      t.clock.advance(stored.holdExpiresAt!.getTime() - t.clock.now().getTime() - 1);
      expect(await service.expireTrip(bookable.trip.tripId)).toBe(0);
      t.clock.advance(1);
      expect(await service.expireTrip(bookable.trip.tripId)).toBe(1);
    });
  });

  describe('Schalterkanal im Service', () => {
    it('verkauft Sitze außerhalb des Online-Kontingents, respektiert aber Sperren', async () => {
      const bookable = await createBookableTrip(t.prisma, {
        trip: { onlineLabels: ['1A'], blockedLabels: ['9B'] },
      });
      const service = t.app.get(BookingsService);
      // Der Service bekommt bereits geprüfte Eingaben; das Schema der Route übernimmt hier parse().
      const input = (label: string): CreateBookingInput =>
        createBookingSchema.parse(
          bookingBody(bookable, { passengers: [{ label, gender: 'MALE' }] }),
        );
      const counter = await service.hold(input('9A'), {
        channel: 'COUNTER',
        idempotencyKey: null,
        context: {},
      });
      expect(counter.booking.status).toBe('HELD');
      expect(counter.booking.channel).toBe('COUNTER');
      await expect(
        service.hold(input('9B'), { channel: 'COUNTER', idempotencyKey: null, context: {} }),
      ).rejects.toMatchObject({ code: 'SEAT_BLOCKED' });
    });
  });

  describe('Outbox', () => {
    it('stellt Bestätigungen per E-Mail zu und markiert Einträge ohne Adresse als erledigt', async () => {
      await t.prisma.outbox.updateMany({ where: { status: 'PENDING' }, data: { status: 'DONE' } });
      const bookable = await createBookableTrip(t.prisma);
      const cookie = await staffSession(bookable.fixture.companyId);
      const email = `fahrgast-${randomUUID()}@example.com`;
      const withMail = await hold(t, bookable, {
        passengers: [{ label: '1A', gender: 'MALE' }],
        email,
      });
      const withoutMail = await hold(t, bookable, {
        passengers: [{ label: '1C', gender: 'MALE' }],
      });
      for (const booking of [withMail, withoutMail]) {
        await guestPost(t, booking, 'reserve-cash').expect(200);
        await t
          .http()
          .post(
            `/api/v1/companies/${bookable.fixture.companyId}/bookings/${booking.id}/confirm-cash`,
          )
          .set('Cookie', cookie)
          .expect(200);
      }
      const sentBefore = t.mailer.sent.length;
      const worker = t.app.get(OutboxWorker);
      const result = await worker.runOnce();
      expect(result).toEqual({ done: 6, retried: 0, failed: 0 });
      const mails = t.mailer.sent.slice(sentBefore);
      // Zahlungsaufforderung ist überholt (bereits bestätigt), nur die Bestätigung geht hinaus.
      expect(mails.map((mail) => mail.to)).toEqual([email]);
      expect(mails[0]!.subject).toContain(formatBookingCode(withMail.bookingCode));
      expect(mails[0]!.subject).toContain('confirmed');
      expect(await t.prisma.outbox.count({ where: { status: 'PENDING' } })).toBe(0);
      expect((await worker.runOnce()).done).toBe(0);
    });

    it('verschickt eine überholte Bestätigung nach Storno nicht mehr (Wiederholung nach Fehlversuch)', async () => {
      await t.prisma.outbox.updateMany({ where: { status: 'PENDING' }, data: { status: 'DONE' } });
      const bookable = await createBookableTrip(t.prisma);
      const cookie = await staffSession(bookable.fixture.companyId);
      const email = `fahrgast-${randomUUID()}@example.com`;
      const booking = await hold(t, bookable, {
        passengers: [{ label: '1A', gender: 'MALE' }],
        email,
      });
      await guestPost(t, booking, 'reserve-cash').expect(200);
      await t
        .http()
        .post(`/api/v1/companies/${bookable.fixture.companyId}/bookings/${booking.id}/confirm-cash`)
        .set('Cookie', cookie)
        .expect(200);
      const worker = t.app.get(OutboxWorker);
      const send = t.mailer.send.bind(t.mailer);
      t.mailer.send = () =>
        Promise.reject(Object.assign(new Error('421 try later'), { code: 'ECONNECTION' }));
      try {
        // HELD und die überholte Zahlungsaufforderung sind erledigt, die Bestätigung scheitert.
        expect(await worker.runOnce()).toEqual({ done: 2, retried: 1, failed: 0 });
      } finally {
        t.mailer.send = send;
      }
      await t
        .http()
        .post(`/api/v1/companies/${bookable.fixture.companyId}/bookings/${booking.id}/cancel`)
        .set('Cookie', cookie)
        .send({ reason: 'OPERATIONAL' })
        .expect(200);
      const sentBefore = t.mailer.sent.length;
      t.clock.advance(31_000);
      expect(await worker.runOnce()).toEqual({ done: 2, retried: 0, failed: 0 });
      const mails = t.mailer.sent.slice(sentBefore);
      expect(mails).toHaveLength(1);
      expect(mails[0]!.subject).toContain('cancelled');
      const confirmed = await t.prisma.outbox.findFirstOrThrow({
        where: { aggregateId: booking.id, type: 'BOOKING_CONFIRMED' },
      });
      expect(confirmed.status).toBe('DONE');
    });

    it('wiederholt fehlgeschlagene Zustellungen mit Wartezeit und gibt nach der Höchstzahl auf', async () => {
      await t.prisma.outbox.updateMany({ where: { status: 'PENDING' }, data: { status: 'DONE' } });
      const bookable = await createBookableTrip(t.prisma);
      const email = `fahrgast-${randomUUID()}@example.com`;
      const held = await hold(t, bookable, {
        passengers: [{ label: '1A', gender: 'MALE' }],
        email,
      });
      await guestPost(t, held, 'reserve-cash').expect(200);
      const worker = t.app.get(OutboxWorker);
      const send = t.mailer.send.bind(t.mailer);
      t.mailer.send = () =>
        Promise.reject(Object.assign(new Error(`550 unknown <${email}>`), { code: 'EENVELOPE' }));
      try {
        expect(await worker.runOnce()).toEqual({ done: 1, retried: 1, failed: 0 });
        const entry = await t.prisma.outbox.findFirstOrThrow({
          where: { aggregateId: held.id, type: 'BOOKING_RESERVED' },
        });
        expect(entry).toMatchObject({
          status: 'PENDING',
          attempts: 1,
          lastError: 'Error:EENVELOPE',
        });
        expect(entry.nextAttemptAt.getTime() - t.clock.now().getTime()).toBeGreaterThan(29_000);
        // Vor Ablauf der Wartezeit passiert nichts.
        expect(await worker.runOnce()).toEqual({ done: 0, retried: 0, failed: 0 });
        for (let attempt = 2; attempt <= 8; attempt++) {
          t.clock.advance(61 * MINUTE);
          await worker.runOnce();
        }
        const failed = await t.prisma.outbox.findUniqueOrThrow({ where: { id: entry.id } });
        expect(failed).toMatchObject({ status: 'FAILED', attempts: 8 });
        expect(failed.lastError).not.toContain(email);
      } finally {
        t.mailer.send = send;
      }
      // Erfolgreich nach Fehlern: Eine neue Aufgabe läuft normal durch.
      await guestPost(t, held, 'cancel').expect(200);
      expect((await worker.runOnce()).done).toBe(1);
    });
  });

  it('hat die Indizes der Migration 20261102040434_buchungskern_indizes', async () => {
    const rows = await t.prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'booking' ORDER BY indexname`;
    expect(rows.map((row) => row.indexname)).toEqual(
      expect.arrayContaining([
        'booking_contact_phone_e164_status_idx',
        'booking_status_deadline_at_idx',
      ]),
    );
  });
});

/** Die 5 Zufallsbytes, aus denen ein Code entstanden ist (Umkehrung von encodeBookingCode). */
function codeBytes(code: string): Uint8Array {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let bits = 0n;
  for (const char of code) {
    bits = (bits << 5n) | BigInt(alphabet.indexOf(char));
  }
  const bytes = new Uint8Array(5);
  for (let i = 4; i >= 0; i--) {
    bytes[i] = Number(bits & 0xffn);
    bits >>= 8n;
  }
  return bytes;
}
