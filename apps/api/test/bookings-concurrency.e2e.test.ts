import { randomUUID } from 'node:crypto';

import type pg from 'pg';
import type { Response } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { BookingExpiryJob } from '../src/modules/bookings/booking-expiry.job.js';
import { hashSecret } from '../src/modules/bookings/domain/secrets.js';
import { createTestApp, resetDatabase, type TestApp } from './helpers/app.js';
import {
  type BookableTrip,
  bookingBody,
  bookingState,
  createBookableTrip,
  hold,
  postBooking,
  waitUntilApiBlocked,
} from './helpers/bookings.js';
import { connectRaw } from './helpers/inventory.js';

/**
 * Nebenläufigkeit des Buchungskerns mit echten Datenbankverbindungen (AGENTS.md, kritische Pfade).
 *
 * Muster: Eine eigene Verbindung (`holder`) sperrt die Trip-Zeile. Danach starten zwei Anfragen an
 * die API; jede läuft in einer eigenen Pool-Verbindung und wartet auf die Sperre. Eine dritte
 * Verbindung (`observer`) sieht in `pg_stat_activity`, dass beide warten. Erst dann gibt `holder`
 * frei. So prüft der Test echtes Gegeneinander, nicht zufällig nacheinander laufende Anfragen.
 */

const MINUTE = 60_000;

describe('Buchungskern unter Nebenläufigkeit', () => {
  let t: TestApp;
  let holder: pg.Client;
  let observer: pg.Client;

  beforeAll(async () => {
    await resetDatabase();
    t = await createTestApp();
    holder = await connectRaw();
    observer = await connectRaw();
  });

  afterAll(async () => {
    await holder.end();
    await observer.end();
    await t.app.close();
  });

  beforeEach(() => {
    t.resetRateLimits();
    t.clock.advance(Date.now() - t.clock.now().getTime());
  });

  /** Sperrt die Fahrt, startet die Anfragen, wartet bis alle blockiert sind, gibt frei. */
  async function race(
    bookable: BookableTrip,
    requests: (() => PromiseLike<Response>)[],
  ): Promise<Response[]> {
    await holder.query('BEGIN');
    try {
      await holder.query('SELECT id FROM trip WHERE id = $1 FOR UPDATE', [bookable.trip.tripId]);
      const pending = requests.map((request) => Promise.resolve(request()));
      await waitUntilApiBlocked(observer, requests.length);
      await holder.query('COMMIT');
      return await Promise.all(pending);
    } catch (error) {
      await holder.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  }

  function outcome(responses: Response[]): string[] {
    return responses
      .map((res) => `${res.status} ${(res.body as { code?: string }).code ?? 'ok'}`)
      .sort();
  }

  it('zwei gleichzeitige Reservierungen desselben Sitzes: genau eine gewinnt', async () => {
    const bookable = await createBookableTrip(t.prisma);
    const seat = [{ label: '3A', gender: 'MALE' as const }];
    const responses = await race(bookable, [
      () => postBooking(t, bookingBody(bookable, { passengers: seat })),
      () => postBooking(t, bookingBody(bookable, { passengers: seat })),
    ]);
    expect(outcome(responses)).toEqual(['201 ok', '409 SEAT_TAKEN']);
    expect(
      await t.prisma.seatOccupation.count({
        where: { tripId: bookable.trip.tripId, seatId: bookable.trip.seatIdByLabel.get('3A')! },
      }),
    ).toBe(1);
    // Die Verliererin hinterlässt nichts: keine Buchung, kein Audit, keine Outbox.
    expect(await t.prisma.booking.count({ where: { tripId: bookable.trip.tripId } })).toBe(1);
  });

  it('überlappende Teilstrecken: genau eine gewinnt; angrenzende bekommen beide den Sitz', async () => {
    const bookable = await createBookableTrip(t.prisma);
    const seat = [{ label: '4A', gender: 'MALE' as const }];
    const overlapping = await race(bookable, [
      () => postBooking(t, bookingBody(bookable, { passengers: seat, from: 0, to: 2 })),
      () => postBooking(t, bookingBody(bookable, { passengers: seat, from: 1, to: 3 })),
    ]);
    expect(outcome(overlapping)).toEqual(['201 ok', '409 SEAT_TAKEN']);

    const seat2 = [{ label: '5A', gender: 'MALE' as const }];
    const adjacent = await race(bookable, [
      () => postBooking(t, bookingBody(bookable, { passengers: seat2, from: 0, to: 2 })),
      () => postBooking(t, bookingBody(bookable, { passengers: seat2, from: 2, to: 3 })),
    ]);
    expect(outcome(adjacent)).toEqual(['201 ok', '201 ok']);
  });

  it('Geschlechtsregel ohne Datenbank-Constraint: Frau und Mann gleichzeitig nebeneinander, genau eine gewinnt', async () => {
    // Das EXCLUDE-Constraint schützt hier nicht (zwei verschiedene Sitze); nur die Trip-Sperre.
    const bookable = await createBookableTrip(t.prisma);
    const responses = await race(bookable, [
      () =>
        postBooking(t, bookingBody(bookable, { passengers: [{ label: '6A', gender: 'FEMALE' }] })),
      () =>
        postBooking(t, bookingBody(bookable, { passengers: [{ label: '6B', gender: 'MALE' }] })),
    ]);
    expect(outcome(responses)).toEqual(['201 ok', '409 GENDER_RULE_CONFLICT']);
    expect(await t.prisma.seatOccupation.count({ where: { tripId: bookable.trip.tripId } })).toBe(
      1,
    );
  });

  it('derselbe Idempotency-Key gleichzeitig: eine Buchung, beide Antworten nennen sie', async () => {
    const bookable = await createBookableTrip(t.prisma);
    const key = randomUUID();
    const body = bookingBody(bookable, { passengers: [{ label: '7A', gender: 'MALE' }] });
    const responses = await race(bookable, [
      () => postBooking(t, body, key),
      () => postBooking(t, body, key),
    ]);
    expect(responses.map((res) => res.status).sort()).toEqual([200, 201]);
    const ids = responses.map((res) => (res.body as { booking: { id: string } }).booking.id);
    expect(new Set(ids).size).toBe(1);
    expect(await t.prisma.booking.count({ where: { idempotencyKey: hashSecret(key) } })).toBe(1);
  });

  it('Ablauf-Job gegen gleichzeitige Reservierung: Sitz geht an die neue Buchung, Ablauf genau einmal', async () => {
    const bookable = await createBookableTrip(t.prisma);
    const old = await hold(t, bookable, { passengers: [{ label: '8A', gender: 'MALE' }] });
    t.clock.advance(16 * MINUTE);
    const job = t.app.get(BookingExpiryJob);

    await holder.query('BEGIN');
    let fresh: Promise<Response>;
    try {
      await holder.query('SELECT id FROM trip WHERE id = $1 FOR UPDATE', [bookable.trip.tripId]);
      fresh = Promise.resolve(
        postBooking(t, bookingBody(bookable, { passengers: [{ label: '8A', gender: 'MALE' }] })),
      );
      await waitUntilApiBlocked(observer, 1);
      // Die Fahrt ist gesperrt: Der Job wartet nicht, sondern überlässt sie der laufenden Buchung.
      // (Abgelaufene Holds anderer Fahrten aus früheren Tests darf er dabei freigeben.)
      await job.runOnce();
      expect((await bookingState(t.prisma, old.id)).status).toBe('HELD');
      await holder.query('COMMIT');
    } catch (error) {
      await holder.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
    // Job und Buchung treffen nun gleichzeitig auf die Fahrt.
    const [res] = await Promise.all([fresh, job.runOnce()]);
    expect(res.status).toBe(201);
    expect(await bookingState(t.prisma, old.id)).toMatchObject({
      status: 'EXPIRED',
      occupations: 0,
    });
    expect(
      await t.prisma.auditLog.count({ where: { entityId: old.id, action: 'BOOKING_EXPIRED' } }),
    ).toBe(1);
    expect(
      await t.prisma.outbox.count({ where: { aggregateId: old.id, type: 'BOOKING_EXPIRED' } }),
    ).toBe(1);
    const newId = (res.body as { booking: { id: string } }).booking.id;
    expect(await bookingState(t.prisma, newId)).toMatchObject({ status: 'HELD', occupations: 1 });
  });

  it('zwei Ablauf-Jobs gleichzeitig verarbeiten jede Buchung genau einmal', async () => {
    const bookable = await createBookableTrip(t.prisma);
    const held = await Promise.all(
      ['9C', '9D', '10C'].map((label) =>
        hold(t, bookable, { passengers: [{ label, gender: 'MALE' }] }),
      ),
    );
    t.clock.advance(16 * MINUTE);
    const job = t.app.get(BookingExpiryJob);
    const results = await Promise.all([job.runOnce(), job.runOnce()]);
    expect(results.reduce((sum, result) => sum + result.expired, 0)).toBeGreaterThanOrEqual(3);
    for (const booking of held) {
      expect(await bookingState(t.prisma, booking.id)).toMatchObject({
        status: 'EXPIRED',
        occupations: 0,
      });
      expect(
        await t.prisma.auditLog.count({
          where: { entityId: booking.id, action: 'BOOKING_EXPIRED' },
        }),
      ).toBe(1);
    }
  });

  it('bricht nach lock_timeout mit 503 und Retry-After ab, statt endlos zu warten', async () => {
    const bookable = await createBookableTrip(t.prisma);
    await holder.query('BEGIN');
    try {
      await holder.query('SELECT id FROM trip WHERE id = $1 FOR UPDATE', [bookable.trip.tripId]);
      const res = await postBooking(
        t,
        bookingBody(bookable, { passengers: [{ label: '1A', gender: 'MALE' }] }),
      );
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
      expect(res.headers['retry-after']).toBe('2');
    } finally {
      await holder.query('ROLLBACK');
    }
  }, 15_000);
});
