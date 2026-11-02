import { randomUUID } from 'node:crypto';

import { formatBookingCode } from '@masar/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { hashSecret } from '../src/modules/bookings/domain/secrets.js';
import { LOOKUP_ATTEMPTS_PER_CODE, LookupLimiter } from '../src/modules/bookings/lookup-limiter.js';
import { ACCESS_TOKEN_TTL_MS } from '../src/modules/bookings/bookings.service.js';
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
  createBookableTrip,
  guestPost,
  hold,
  type HeldBooking,
} from './helpers/bookings.js';
import { createSearchTrip } from './helpers/search.js';

/**
 * Ticketseite und Gastzugriff über Code und Telefon (Schritt 1.4, ADR 0022) gegen PostgreSQL. Die
 * Log-Ausgabe prüft `bookings-logging.e2e.test.ts`.
 */

interface TicketBody {
  id: string;
  bookingCode: string;
  status: string;
  total: { amountMinor: number; currency: string };
  trip: { id: string; status: string; departureAt: string; company: { nameEn: string } };
  from: { nameEn: string };
  to: { nameEn: string };
  stops: { tripStopId: string; nameEn: string }[];
  passengers: Record<string, unknown>[];
  tickets: {
    id: string;
    passengerId: string;
    seatLabel: string;
    status: string;
    qrToken: string | null;
  }[];
}

interface LookupBody {
  accessToken: string;
  accessExpiresAt: string;
  booking: TicketBody;
}

const PHONE = '+963933777001';

describe('Ticketseite und Suche nach Code und Telefon (Integration)', () => {
  let t: TestApp;
  let bookable: BookableTrip;
  let cookie: string;

  beforeAll(async () => {
    await resetDatabase();
    t = await createTestApp();
    bookable = await createBookableTrip(t.prisma);
    const email = `agent-${randomUUID()}@firma.example`;
    await createStaff(t.prisma, {
      email,
      password: PASSWORD,
      memberships: [{ companyId: bookable.fixture.companyId, role: 'AGENT' }],
    });
    cookie = await loginAs(t, email);
  });

  afterAll(async () => {
    await t.app.close();
  });

  beforeEach(() => {
    t.resetRateLimits();
    t.app.get(LookupLimiter).reset();
    t.clock.advance(Date.now() - t.clock.now().getTime());
  });

  /** Jede Buchung auf einer eigenen Fahrt derselben Firma, damit die Sitze frei sind. */
  async function freshTrip(): Promise<BookableTrip> {
    const trip = await createSearchTrip(t.prisma, bookable.fixture, {
      departureAt: bookable.departureAt,
    });
    return { ...bookable, trip };
  }

  async function confirmed(phone = PHONE): Promise<HeldBooking> {
    const booking = await hold(t, await freshTrip(), {
      passengers: [
        { label: '1A', gender: 'FEMALE', fullName: 'Lina Haddad' },
        { label: '1B', gender: 'FEMALE', fullName: 'Rana Haddad' },
      ],
      from: 1,
      to: 3,
      phone,
    });
    await guestPost(t, booking, 'reserve-cash').expect(200);
    await t
      .http()
      .post(`/api/v1/companies/${bookable.fixture.companyId}/bookings/${booking.id}/confirm-cash`)
      .set('Cookie', cookie)
      .expect(200);
    return booking;
  }

  function lookup(body: Record<string, unknown>): ReturnType<ReturnType<TestApp['http']>['post']> {
    return t.http().post('/api/v1/bookings/lookup').send(body);
  }

  function ticket(
    bookingId: string,
    token: string | undefined,
  ): ReturnType<ReturnType<TestApp['http']>['get']> {
    const req = t.http().get(`/api/v1/bookings/${bookingId}/ticket`);
    return token === undefined ? req : req.set('X-Manage-Token', token);
  }

  describe('GET /bookings/:id/ticket', () => {
    it('zeigt Fahrt, Halte, Fahrgäste ohne Kontakt, Geschlecht und Ausweis, Tickets mit QR-Token', async () => {
      const booking = await confirmed();
      const res = await ticket(booking.id, booking.manageToken).expect(200);
      const body = res.body as TicketBody;
      expect(body.status).toBe('CONFIRMED');
      expect(body.bookingCode).toBe(booking.bookingCode);
      expect(body.trip.status).toBe('SCHEDULED');
      expect(body.total).toEqual({ amountMinor: 80_000, currency: 'SYP' });
      // Teilstrecke 1→3: drei Halte in Fahrtrichtung.
      expect(body.stops.map((stop) => stop.nameEn)).toEqual([
        body.from.nameEn,
        expect.any(String) as unknown,
        body.to.nameEn,
      ]);
      expect(body.passengers).toHaveLength(2);
      for (const passenger of body.passengers) {
        expect(Object.keys(passenger).sort()).toEqual(['fullName', 'id', 'seatLabel', 'status']);
      }
      expect(JSON.stringify(body)).not.toContain(PHONE);
      expect(body).not.toHaveProperty('contact');
      expect(body.tickets.map((entry) => entry.status)).toEqual(['ISSUED', 'ISSUED']);

      // Das QR-Token: 256 Bit, nur sein SHA-256 steht in der Datenbank.
      const stored = await t.prisma.ticket.findMany({
        where: { bookingId: booking.id },
        select: { id: true, qrTokenHash: true },
      });
      for (const entry of body.tickets) {
        expect(entry.qrToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
        const row = stored.find((candidate) => candidate.id === entry.id);
        expect(row?.qrTokenHash).toBe(hashSecret(entry.qrToken ?? ''));
        expect(row?.qrTokenHash).not.toContain(entry.qrToken);
      }
    });

    it('liefert bei jedem Abruf denselben QR-Code, ohne den Hash zu ändern', async () => {
      const booking = await confirmed();
      const first = (await ticket(booking.id, booking.manageToken).expect(200)).body as TicketBody;
      const before = await t.prisma.ticket.findMany({
        where: { bookingId: booking.id },
        select: { qrTokenHash: true, updatedAt: true },
        orderBy: { id: 'asc' },
      });
      const second = (await ticket(booking.id, booking.manageToken).expect(200)).body as TicketBody;
      expect(second.tickets.map((entry) => entry.qrToken)).toEqual(
        first.tickets.map((entry) => entry.qrToken),
      );
      const after = await t.prisma.ticket.findMany({
        where: { bookingId: booking.id },
        select: { qrTokenHash: true, updatedAt: true },
        orderBy: { id: 'asc' },
      });
      expect(after).toEqual(before);
    });

    it('ersetzt einen alten Hash und entwertet mit neuer Version den alten QR-Code', async () => {
      const booking = await confirmed();
      const original = (await ticket(booking.id, booking.manageToken).expect(200))
        .body as TicketBody;
      const target = original.tickets[0]!;
      // Ticket aus der Zeit vor ADR 0022 (zufälliger Hash) und eine neue Version zugleich.
      await t.prisma.ticket.update({
        where: { id: target.id },
        data: { qrTokenHash: hashSecret(randomUUID()), version: { increment: 1 } },
      });
      const renewed = (await ticket(booking.id, booking.manageToken).expect(200))
        .body as TicketBody;
      const token = renewed.tickets.find((entry) => entry.id === target.id)?.qrToken ?? '';
      expect(token).not.toBe(target.qrToken);
      const row = await t.prisma.ticket.findUniqueOrThrow({ where: { id: target.id } });
      expect(row.qrTokenHash).toBe(hashSecret(token));
    });

    it('zeigt QR-Codes nur für bestätigte Buchungen', async () => {
      const held = await hold(t, await freshTrip(), {
        passengers: [{ label: '1A', gender: 'MALE' }],
      });
      const asHeld = (await ticket(held.id, held.manageToken).expect(200)).body as TicketBody;
      expect(asHeld.status).toBe('HELD');
      expect(asHeld.tickets).toEqual([]);

      const booking = await confirmed();
      await t
        .http()
        .post(`/api/v1/companies/${bookable.fixture.companyId}/bookings/${booking.id}/cancel`)
        .set('Cookie', cookie)
        .send({ reason: 'OPERATIONAL' })
        .expect(200);
      const cancelled = (await ticket(booking.id, booking.manageToken).expect(200))
        .body as TicketBody;
      expect(cancelled.status).toBe('CANCELLED');
      expect(cancelled.tickets.map((entry) => [entry.status, entry.qrToken])).toEqual([
        ['VOID', null],
        ['VOID', null],
      ]);
    });

    it('antwortet ohne, mit falschem Token und für unbekannte IDs mit derselben 404', async () => {
      const booking = await confirmed();
      const responses = await Promise.all([
        ticket(booking.id, undefined),
        ticket(booking.id, 'A'.repeat(22)),
        ticket(booking.id, 'A'.repeat(32)),
        ticket(randomUUID(), booking.manageToken),
      ]);
      for (const res of responses) {
        expect(res.status).toBe(404);
        expect((res.body as { code: string }).code).toBe('BOOKING_NOT_FOUND');
      }
    });
  });

  describe('POST /bookings/lookup', () => {
    it('findet die Buchung mit Code und Telefon in beliebiger Schreibweise und gibt ein Lesetoken', async () => {
      const booking = await confirmed('+963933777002');
      const res = await lookup({
        bookingCode: formatBookingCode(booking.bookingCode).toLowerCase(),
        phone: '0933 777 002',
      }).expect(200);
      const body = res.body as LookupBody;
      expect(body.accessToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
      expect(Date.parse(body.accessExpiresAt) - t.clock.now().getTime()).toBe(ACCESS_TOKEN_TTL_MS);
      expect(body.booking.id).toBe(booking.id);
      expect(body.booking.tickets.every((entry) => entry.qrToken !== null)).toBe(true);
      expect(JSON.stringify(body)).not.toContain('933777002');

      // Das Lesetoken öffnet Ticketseite und Buchung, aber ändert nichts.
      const viaToken = (await ticket(booking.id, body.accessToken).expect(200)).body as TicketBody;
      expect(viaToken.tickets.map((entry) => entry.qrToken)).toEqual(
        body.booking.tickets.map((entry) => entry.qrToken),
      );
      await t
        .http()
        .get(`/api/v1/bookings/${booking.id}`)
        .set('X-Manage-Token', body.accessToken)
        .expect(200);
      const cancel = await guestPost(
        t,
        { id: booking.id, manageToken: body.accessToken },
        'cancel',
      );
      expect(cancel.status).toBe(404);
      expect((cancel.body as { code: string }).code).toBe('BOOKING_NOT_FOUND');
      // Das Verwaltungstoken des ersten Geräts gilt weiter.
      await ticket(booking.id, booking.manageToken).expect(200);
    });

    it('gibt für falsches Telefon und unbekannten Code genau dieselbe Antwort', async () => {
      const booking = await confirmed('+963933777003');
      const wrongPhone = await lookup({ bookingCode: booking.bookingCode, phone: '0933777004' });
      const unknownCode = await lookup({ bookingCode: 'ZZZZZZZZ', phone: '0933777003' });
      for (const res of [wrongPhone, unknownCode]) {
        expect(res.status).toBe(404);
        expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
      }
      const strip = (body: Record<string, unknown>): Record<string, unknown> => {
        const { instance: _instance, ...rest } = body;
        return rest;
      };
      expect(strip(wrongPhone.body as Record<string, unknown>)).toEqual(
        strip(unknownCode.body as Record<string, unknown>),
      );
      expect((wrongPhone.body as { code: string }).code).toBe('BOOKING_NOT_FOUND');
    });

    it('verlangt gültige Form von Code und Telefon', async () => {
      const res = await lookup({ bookingCode: 'kurz', phone: 'abc' }).expect(400);
      expect((res.body as { errors: { path: string }[] }).errors.map((e) => e.path).sort()).toEqual(
        ['bookingCode', 'phone'],
      );
    });

    it('läuft nach zwölf Stunden ab', async () => {
      const booking = await confirmed('+963933777005');
      const body = (
        await lookup({ bookingCode: booking.bookingCode, phone: '+963933777005' }).expect(200)
      ).body as LookupBody;
      t.clock.advance(ACCESS_TOKEN_TTL_MS);
      const res = await ticket(booking.id, body.accessToken);
      expect(res.status).toBe(404);
    });

    it('begrenzt je IP auf fünf Versuche in der Minute', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) {
        const res = await lookup({ bookingCode: `ZZZZZZZ${String(i)}`, phone: '0933777009' });
        statuses.push(res.status);
        if (res.status === 429) {
          expect((res.body as { code: string }).code).toBe('RATE_LIMITED');
          expect(res.headers['retry-after']).toBeDefined();
        }
      }
      expect(statuses).toEqual([404, 404, 404, 404, 404, 429]);
    });

    it('begrenzt je Code, auch über viele IPs und für unbekannte Codes gleich', async () => {
      const booking = await confirmed('+963933777006');
      const tryCode = async (code: string, phone: string): Promise<number> => {
        // Jede Runde wie von einer neuen IP: Die Grenze je IP setzt der Test zurück.
        t.resetRateLimits();
        return (await lookup({ bookingCode: code, phone })).status;
      };
      const known: number[] = [];
      const unknown: number[] = [];
      for (let i = 0; i < LOOKUP_ATTEMPTS_PER_CODE; i++) {
        known.push(await tryCode(booking.bookingCode, `+9639337771${String(i).padStart(2, '0')}`));
        unknown.push(await tryCode('YYYYYYYY', '+963933777006'));
      }
      expect(new Set(known)).toEqual(new Set([404]));
      expect(new Set(unknown)).toEqual(new Set([404]));
      // Auch das richtige Telefon hilft dann nicht mehr: dieselbe 429 wie beim unbekannten Code.
      const blockedKnown = await lookup({
        bookingCode: booking.bookingCode,
        phone: '+963933777006',
      });
      t.resetRateLimits();
      const blockedUnknown = await lookup({ bookingCode: 'YYYYYYYY', phone: '+963933777006' });
      for (const res of [blockedKnown, blockedUnknown]) {
        expect(res.status).toBe(429);
        expect((res.body as { code: string }).code).toBe('RATE_LIMITED');
        expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
      }
    });
  });
});
