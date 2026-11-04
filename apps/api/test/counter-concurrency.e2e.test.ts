import { randomUUID } from 'node:crypto';

import type pg from 'pg';
import type { Response } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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
  type PassengerInput,
  postBooking,
  waitUntilApiBlocked,
} from './helpers/bookings.js';
import { connectRaw } from './helpers/inventory.js';

/**
 * Schaltermodus unter Nebenläufigkeit mit echten Datenbankverbindungen (Schritt 2.6, AGENTS.md).
 * Muster wie `bookings-concurrency.e2e.test.ts`: `holder` sperrt die Trip-Zeile, die Anfragen
 * warten in eigenen Pool-Verbindungen, `observer` sieht beide warten, erst dann gibt `holder` frei.
 */
describe('Schaltermodus unter Nebenläufigkeit', () => {
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

  async function agent(companyId: string): Promise<string> {
    const email = `agent-${randomUUID()}@firma.example`;
    await createStaff(t.prisma, {
      email,
      password: PASSWORD,
      memberships: [{ companyId, role: 'AGENT' }],
    });
    return loginAs(t, email);
  }

  function sell(
    bookable: BookableTrip,
    cookie: string,
    passengers: PassengerInput[],
    range: { from?: number; to?: number } = {},
    key: string = randomUUID(),
  ): Promise<Response> {
    return Promise.resolve(
      t
        .http()
        .post(`/api/v1/companies/${bookable.fixture.companyId}/counter/sales`)
        .set('Cookie', cookie)
        .set('Idempotency-Key', key)
        .send(bookingBody(bookable, { passengers, ...range })),
    );
  }

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

  async function occupations(bookable: BookableTrip, label: string): Promise<number> {
    return t.prisma.seatOccupation.count({
      where: { tripId: bookable.trip.tripId, seatId: bookable.trip.seatIdByLabel.get(label)! },
    });
  }

  it('Schalter und online kaufen gleichzeitig denselben Sitz: genau einer gewinnt', async () => {
    const bookable = await createBookableTrip(t.prisma);
    const cookie = await agent(bookable.fixture.companyId);
    const seat = [{ label: '3A', gender: 'MALE' as const }];
    const responses = await race(bookable, [
      () => sell(bookable, cookie, seat),
      () => postBooking(t, bookingBody(bookable, { passengers: seat })),
    ]);
    expect(outcome(responses)).toEqual(['201 ok', '409 SEAT_TAKEN']);
    expect(await occupations(bookable, '3A')).toBe(1);
    expect(await t.prisma.booking.count({ where: { tripId: bookable.trip.tripId } })).toBe(1);
  });

  it('zwei Schalterverkäufe mit überlappenden Teilstrecken: genau einer; angrenzend beide', async () => {
    const bookable = await createBookableTrip(t.prisma);
    const cookie = await agent(bookable.fixture.companyId);
    const seat = [{ label: '4A', gender: 'MALE' as const }];
    const overlapping = await race(bookable, [
      () => sell(bookable, cookie, seat, { from: 0, to: 2 }),
      () => sell(bookable, cookie, seat, { from: 1, to: 3 }),
    ]);
    expect(outcome(overlapping)).toEqual(['201 ok', '409 SEAT_TAKEN']);
    expect(await occupations(bookable, '4A')).toBe(1);

    const seat2 = [{ label: '5A', gender: 'MALE' as const }];
    const adjacent = await race(bookable, [
      () => sell(bookable, cookie, seat2, { from: 0, to: 2 }),
      () => sell(bookable, cookie, seat2, { from: 2, to: 3 }),
    ]);
    expect(outcome(adjacent)).toEqual(['201 ok', '201 ok']);
  });

  it('Geschlechtsregel: Frau und Mann gleichzeitig nebeneinander am Schalter, genau einer', async () => {
    const bookable = await createBookableTrip(t.prisma);
    const cookie = await agent(bookable.fixture.companyId);
    const responses = await race(bookable, [
      () => sell(bookable, cookie, [{ label: '6A', gender: 'FEMALE' }]),
      () => sell(bookable, cookie, [{ label: '6B', gender: 'MALE' }]),
    ]);
    expect(outcome(responses)).toEqual(['201 ok', '409 GENDER_RULE_CONFLICT']);
  });

  it('doppelte Absendung mit demselben Idempotency-Key: eine Buchung, beide Antworten gleich', async () => {
    const bookable = await createBookableTrip(t.prisma);
    const cookie = await agent(bookable.fixture.companyId);
    const key = randomUUID();
    const seat = [{ label: '7A', gender: 'MALE' as const }];
    const responses = await race(bookable, [
      () => sell(bookable, cookie, seat, {}, key),
      () => sell(bookable, cookie, seat, {}, key),
    ]);
    expect(outcome(responses)).toEqual(['200 ok', '201 ok']);
    const ids = responses.map((res) => (res.body as { booking: { id: string } }).booking.id);
    expect(ids[0]).toBe(ids[1]);
    expect(await t.prisma.booking.count({ where: { tripId: bookable.trip.tripId } })).toBe(1);
    expect(await occupations(bookable, '7A')).toBe(1);
  });
});
