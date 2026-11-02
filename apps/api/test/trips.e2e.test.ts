import { localDateInDamascus } from '@masar/shared';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { damascusDayRange } from '../src/modules/trips/domain/search-day.js';
import { seedDemo } from '../prisma/seed/demo.js';
import { createTestApp, resetDatabase, type TestApp } from './helpers/app.js';
import {
  connectRaw,
  createHeldBooking,
  insertOccupation,
  seatId,
  type TripFixture,
} from './helpers/inventory.js';
import { createSearchFixture, createSearchTrip, type SearchFixture } from './helpers/search.js';

/** Kalendertag in Damaskus, `days` Tage nach heute. */
function dayFromNow(days: number): string {
  return localDateInDamascus(new Date(Date.now() + days * 24 * 3_600_000));
}

/** Ortszeit `HH:MM` eines Tages in Damaskus als UTC-Zeitpunkt. */
function localTime(day: string, hours: number, minutes = 0): Date {
  return new Date(damascusDayRange(day).start.getTime() + (hours * 60 + minutes) * 60_000);
}

function nextDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + 24 * 3_600_000).toISOString().slice(0, 10);
}

interface SearchBody {
  items: {
    tripId: string;
    company: { id: string; nameAr: string; nameEn: string };
    departureAt: string;
    arrivalAt: string | null;
    from: { tripStopId: string; cityId: string; departureAt: string | null };
    to: { tripStopId: string; cityId: string; arrivalAt: string | null };
    stops: { tripStopId: string }[];
    fare: { amountMinor: number; currency: string };
    freeSeats: { count: number; capped: boolean };
    genderRuleEnabled: boolean;
  }[];
  nextCursor: string | null;
}

interface SeatMapBody {
  tripId: string;
  fare: { amountMinor: number; currency: string };
  genderRule: { enabled: boolean; applied: boolean };
  layout: { rows: number; columns: number };
  seats: {
    seatId: string;
    label: string;
    row: number;
    column: number;
    side: string;
    state: string;
  }[];
}

describe('Suche und Sitzplan (Integration)', () => {
  let t: TestApp;
  let raw: pg.Client;

  beforeAll(async () => {
    await resetDatabase();
    t = await createTestApp();
    raw = await connectRaw();
  });

  afterAll(async () => {
    await raw.end();
    await t.app.close();
  });

  beforeEach(() => {
    t.resetRateLimits();
  });

  async function search(
    fixture: SearchFixture,
    from: number,
    to: number,
    date: string,
    extra: Record<string, string | number> = {},
  ): Promise<SearchBody> {
    const res = await t
      .http()
      .get('/api/v1/trips/search')
      .query({ from: fixture.cityIds[from], to: fixture.cityIds[to], date, ...extra })
      .expect(200);
    return res.body as SearchBody;
  }

  function seatMap(trip: TripFixture, from: number, to: number, gender?: 'FEMALE' | 'MALE') {
    return t
      .http()
      .get(`/api/v1/trips/${trip.tripId}/seat-map`)
      .query({
        fromStopId: trip.tripStopIds[from],
        toStopId: trip.tripStopIds[to],
        ...(gender === undefined ? {} : { gender }),
      });
  }

  function stateOf(body: SeatMapBody, label: string): string | undefined {
    return body.seats.find((seat) => seat.label === label)?.state;
  }

  /** Belegt einen Sitz an der Anwendung vorbei (wie später der Buchungsservice). */
  async function occupy(
    trip: TripFixture,
    label: string,
    fromSeq: number,
    toSeq: number,
    gender: 'FEMALE' | 'MALE' | null,
  ): Promise<void> {
    const booking = await createHeldBooking(t.prisma, trip, {
      fromSeq,
      toSeq,
      seats: [label],
      ...(gender === null ? {} : { gender }),
    });
    await insertOccupation(raw, {
      tripId: trip.tripId,
      seatId: seatId(trip, label),
      fromSeq,
      toSeq,
      bookingId: booking.bookingId,
      passengerId: booking.passengerIds[0]!,
      gender,
    });
  }

  describe('GET /cities', () => {
    it('listet nur bediente Städte mit Haltestellen, nur Kennungen und Namen', async () => {
      const fixture = await createSearchFixture(t.prisma);
      const lonely = await t.prisma.city.create({
        data: { slug: 'ohne-route', nameAr: 'بلا خط', nameEn: 'Unserved' },
        select: { id: true },
      });
      await t.prisma.station.create({
        data: { cityId: lonely.id, nameAr: 'محطة', nameEn: 'Unused stop' },
      });

      const res = await t.http().get('/api/v1/cities').expect(200);
      const items = (res.body as { items: { id: string; stations: { id: string }[] }[] }).items;
      const ids = items.map((city) => city.id);
      expect(ids).toEqual(expect.arrayContaining(fixture.cityIds));
      expect(ids).not.toContain(lonely.id);

      const first = items.find((city) => city.id === fixture.cityIds[0])!;
      expect(Object.keys(first).sort()).toEqual(['id', 'nameAr', 'nameEn', 'slug', 'stations']);
      expect(first.stations).toEqual([
        { id: fixture.stationIds[0], nameAr: 'محطة 0', nameEn: 'Station 0' },
      ]);
    });

    it('ist ohne Anmeldung erreichbar', async () => {
      await t.http().get('/api/v1/cities').expect(200);
    });
  });

  describe('GET /trips/search', () => {
    it('findet die Nachtfahrt (23:00 ab Start) für den Zwischenhalt am Folgetag', async () => {
      const day = dayFromNow(3);
      const fixture = await createSearchFixture(t.prisma);
      const trip = await createSearchTrip(t.prisma, fixture, { departureAt: localTime(day, 23) });

      // Start → Ziel am Abfahrtstag.
      const fromStart = await search(fixture, 0, 3, day);
      expect(fromStart.items.map((item) => item.tripId)).toEqual([trip.tripId]);

      // Zwischenhalt (01:00 Ortszeit) → Ziel: am Folgetag, nicht am Fahrtag.
      expect((await search(fixture, 1, 3, day)).items).toEqual([]);
      const nextDayResult = await search(fixture, 1, 3, nextDay(day));
      expect(nextDayResult.items).toHaveLength(1);
      const item = nextDayResult.items[0]!;
      expect(item.departureAt).toBe(localTime(nextDay(day), 1).toISOString());
      expect(item.departureAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(item.arrivalAt).toBe(localTime(nextDay(day), 4, 20).toISOString());
      expect(item.from).toMatchObject({
        tripStopId: trip.tripStopIds[1],
        cityId: fixture.cityIds[1],
      });
      expect(item.to).toMatchObject({
        tripStopId: trip.tripStopIds[3],
        cityId: fixture.cityIds[3],
      });
      expect(item.stops.map((stop) => stop.tripStopId)).toEqual(trip.tripStopIds.slice(1));
      expect(item.fare).toEqual({ amountMinor: 40_000, currency: 'SYP' });
      expect(Object.keys(item.company).sort()).toEqual(['id', 'nameAr', 'nameEn']);
      expect(item.company.id).toBe(fixture.companyId);
      expect(item.genderRuleEnabled).toBe(true);
    });

    it('bietet keine Gegenrichtung an', async () => {
      const day = dayFromNow(3);
      const fixture = await createSearchFixture(t.prisma);
      await createSearchTrip(t.prisma, fixture, { departureAt: localTime(day, 8) });
      expect((await search(fixture, 3, 0, day)).items).toEqual([]);
      expect((await search(fixture, 2, 1, day)).items).toEqual([]);
    });

    it('zeigt ein Paar ohne Tarif nicht, andere Paare derselben Fahrt schon', async () => {
      const day = dayFromNow(3);
      const fixture = await createSearchFixture(t.prisma, { fares: { '0-3': 60_000 } });
      const trip = await createSearchTrip(t.prisma, fixture, { departureAt: localTime(day, 8) });
      expect((await search(fixture, 1, 3, day)).items).toEqual([]);
      expect((await search(fixture, 0, 3, day)).items).toHaveLength(1);

      const res = await seatMap(trip, 1, 3, 'FEMALE').expect(409);
      expect(res.body).toMatchObject({ code: 'NO_FARE_FOR_SEGMENT' });
    });

    it('prüft die Tarifgültigkeit am Fahrtag', async () => {
      const day = dayFromNow(3);
      const fixture = await createSearchFixture(t.prisma, { fareValidFrom: nextDay(day) });
      await createSearchTrip(t.prisma, fixture, { departureAt: localTime(day, 8) });
      await createSearchTrip(t.prisma, fixture, { departureAt: localTime(nextDay(day), 8) });
      expect((await search(fixture, 0, 3, day)).items).toEqual([]);
      expect((await search(fixture, 0, 3, nextDay(day))).items).toHaveLength(1);
    });

    it('zeigt keine Fahrt mit geschlossenem Verkauf oder ohne Status SCHEDULED', async () => {
      const day = dayFromNow(3);
      const fixture = await createSearchFixture(t.prisma);
      const open = await createSearchTrip(t.prisma, fixture, { departureAt: localTime(day, 7) });
      const closed = await createSearchTrip(t.prisma, fixture, {
        departureAt: localTime(day, 8),
        onlineSalesCloseAt: new Date(Date.now() - 60_000),
      });
      const draft = await createSearchTrip(t.prisma, fixture, {
        departureAt: localTime(day, 9),
        status: 'DRAFT',
      });
      const cancelled = await createSearchTrip(t.prisma, fixture, {
        departureAt: localTime(day, 10),
        status: 'CANCELLED',
      });

      const result = await search(fixture, 0, 3, day);
      expect(result.items.map((item) => item.tripId)).toEqual([open.tripId]);

      expect((await seatMap(closed, 0, 3).expect(409)).body).toMatchObject({
        code: 'SALES_CLOSED',
      });
      expect((await seatMap(draft, 0, 3).expect(404)).body).toMatchObject({
        code: 'TRIP_NOT_FOUND',
      });
      expect((await seatMap(cancelled, 0, 3).expect(409)).body).toMatchObject({
        code: 'TRIP_NOT_BOOKABLE',
      });
    });

    it('zeigt keine Fahrten einer gesperrten Firma', async () => {
      const day = dayFromNow(3);
      const fixture = await createSearchFixture(t.prisma);
      const trip = await createSearchTrip(t.prisma, fixture, { departureAt: localTime(day, 8) });
      await t.prisma.company.update({
        where: { id: fixture.companyId },
        data: { status: 'SUSPENDED' },
      });
      expect((await search(fixture, 0, 3, day)).items).toEqual([]);
      expect((await seatMap(trip, 0, 3).expect(404)).body).toMatchObject({
        code: 'TRIP_NOT_FOUND',
      });
    });

    it('kappt freie Sitze und zählt nur das Online-Kontingent je Teilstrecke', async () => {
      const day = dayFromNow(3);
      const fixture = await createSearchFixture(t.prisma);
      const full = await createSearchTrip(t.prisma, fixture, { departureAt: localTime(day, 7) });
      // Fünf Sitze online, davon einer gesperrt: vier verkäuflich.
      const small = await createSearchTrip(t.prisma, fixture, {
        departureAt: localTime(day, 8),
        onlineLabels: ['1A', '1B', '1C', '1D', '2A'],
        blockedLabels: ['2A'],
      });
      await occupy(small, '1A', 0, 2, 'FEMALE');

      const whole = await search(fixture, 0, 3, day);
      expect(whole.items.map((item) => [item.tripId, item.freeSeats])).toEqual([
        [full.tripId, { count: 9, capped: true }],
        [small.tripId, { count: 3, capped: false }],
      ]);
      // Ab dem Ausstieg der ersten Person ([2,3)) ist 1A wieder frei.
      const tail = await search(fixture, 2, 3, day);
      expect(tail.items.find((item) => item.tripId === small.tripId)?.freeSeats).toEqual({
        count: 4,
        capped: false,
      });
    });

    it('filtert nach der Zahl der Fahrgäste', async () => {
      const day = dayFromNow(3);
      const fixture = await createSearchFixture(t.prisma);
      await createSearchTrip(t.prisma, fixture, {
        departureAt: localTime(day, 8),
        onlineLabels: ['1A', '1B', '1C'],
      });
      expect((await search(fixture, 0, 3, day, { passengers: 3 })).items).toHaveLength(1);
      expect((await search(fixture, 0, 3, day, { passengers: 4 })).items).toEqual([]);
    });

    it('blättert mit Cursor in der Reihenfolge der Abfahrt', async () => {
      const day = dayFromNow(3);
      const fixture = await createSearchFixture(t.prisma);
      const late = await createSearchTrip(t.prisma, fixture, { departureAt: localTime(day, 18) });
      const early = await createSearchTrip(t.prisma, fixture, { departureAt: localTime(day, 6) });
      const noon = await createSearchTrip(t.prisma, fixture, { departureAt: localTime(day, 12) });

      const first = await search(fixture, 0, 3, day, { limit: 2 });
      expect(first.items.map((item) => item.tripId)).toEqual([early.tripId, noon.tripId]);
      expect(first.nextCursor).toEqual(expect.any(String));
      const second = await search(fixture, 0, 3, day, { limit: 2, cursor: first.nextCursor! });
      expect(second.items.map((item) => item.tripId)).toEqual([late.tripId]);
      expect(second.nextCursor).toBeNull();
    });

    it.each([
      ['keine UUID', { from: 'damascus' }, 'from'],
      ['ungültiger Tag', { date: '2026-02-30' }, 'date'],
      ['falsches Datumsformat', { date: '03.11.2026' }, 'date'],
      ['gleiche Stadt', { to: 'SAME' }, 'to'],
      ['zu viele Fahrgäste', { passengers: 10 }, 'passengers'],
      ['keine Fahrgäste', { passengers: 0 }, 'passengers'],
      ['zu großes Limit', { limit: 51 }, 'limit'],
      ['kaputter Cursor', { cursor: 'abc' }, 'cursor'],
    ])('lehnt ab: %s', async (_name, override, path) => {
      const fixture = await createSearchFixture(t.prisma);
      const query: Record<string, string | number> = {
        from: fixture.cityIds[0]!,
        to: fixture.cityIds[3]!,
        date: dayFromNow(3),
        ...override,
      };
      if (query.to === 'SAME') {
        query.to = query.from!;
      }
      const res = await t.http().get('/api/v1/trips/search').query(query).expect(400);
      expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
      expect((res.body as { errors: { path: string }[] }).errors.map((e) => e.path)).toContain(
        path,
      );
    });

    it('verlangt die Pflichtparameter', async () => {
      const res = await t.http().get('/api/v1/trips/search').expect(400);
      expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('begrenzt auf 60 Anfragen je Minute', async () => {
      const fixture = await createSearchFixture(t.prisma);
      const query = { from: fixture.cityIds[0], to: fixture.cityIds[3], date: dayFromNow(3) };
      for (let i = 0; i < 60; i++) {
        await t.http().get('/api/v1/trips/search').query(query).expect(200);
      }
      const res = await t.http().get('/api/v1/trips/search').query(query).expect(429);
      expect(res.body).toMatchObject({ code: 'RATE_LIMITED' });
      expect(res.headers['retry-after']).toBeDefined();
    });
  });

  describe('GET /trips/:tripId/seat-map', () => {
    it('liefert Layout und Status je Sitz', async () => {
      const day = dayFromNow(3);
      const fixture = await createSearchFixture(t.prisma);
      const trip = await createSearchTrip(t.prisma, fixture, {
        departureAt: localTime(day, 8),
        onlineLabels: [...fixture.seatIdByLabel.keys()].filter((label) => label !== '10A'),
        blockedLabels: ['10B'],
      });
      const res = await seatMap(trip, 0, 3, 'FEMALE').expect(200);
      const body = res.body as SeatMapBody;
      expect(body.tripId).toBe(trip.tripId);
      expect(body.fare).toEqual({ amountMinor: 60_000, currency: 'SYP' });
      expect(body.layout).toEqual({ rows: 11, columns: 5 });
      expect(body.seats).toHaveLength(45);
      expect(body.seats[0]).toEqual({
        seatId: seatId(trip, '1A'),
        label: '1A',
        row: 0,
        column: 0,
        side: 'LEFT',
        state: 'FREE',
      });
      expect(body.seats.find((seat) => seat.label === '11C')).toMatchObject({
        row: 10,
        column: 2,
        side: 'BENCH',
      });
      expect(stateOf(body, '10A')).toBe('NOT_ONLINE');
      expect(stateOf(body, '10B')).toBe('BLOCKED');
    });

    it('gibt einen Sitz am Ausstiegshalt wieder frei ([0,2) belegt, [2,3) frei)', async () => {
      const day = dayFromNow(3);
      const fixture = await createSearchFixture(t.prisma);
      const trip = await createSearchTrip(t.prisma, fixture, { departureAt: localTime(day, 8) });
      await occupy(trip, '5A', 0, 2, 'MALE');

      const tail = (await seatMap(trip, 2, 3, 'MALE').expect(200)).body as SeatMapBody;
      expect(stateOf(tail, '5A')).toBe('FREE');
      const overlapping = (await seatMap(trip, 1, 3, 'MALE').expect(200)).body as SeatMapBody;
      expect(stateOf(overlapping, '5A')).toBe('TAKEN');
    });

    it('wendet die Geschlechtsregel nur mit Angabe und aktivierter Regel an', async () => {
      const day = dayFromNow(3);
      const fixture = await createSearchFixture(t.prisma);
      const trip = await createSearchTrip(t.prisma, fixture, { departureAt: localTime(day, 8) });
      await occupy(trip, '3A', 0, 3, 'MALE');
      await occupy(trip, '4C', 0, 3, null);

      const female = (await seatMap(trip, 0, 3, 'FEMALE').expect(200)).body as SeatMapBody;
      expect(female.genderRule).toEqual({ enabled: true, applied: true });
      expect(stateOf(female, '3A')).toBe('TAKEN');
      expect(stateOf(female, '3B')).toBe('NOT_FOR_YOU');
      expect(stateOf(female, '3C')).toBe('FREE');
      // Belegung ohne Geschlecht: Konflikt für beide.
      expect(stateOf(female, '4D')).toBe('NOT_FOR_YOU');

      const male = (await seatMap(trip, 0, 3, 'MALE').expect(200)).body as SeatMapBody;
      expect(stateOf(male, '3B')).toBe('FREE');
      expect(stateOf(male, '4D')).toBe('NOT_FOR_YOU');

      const anonymous = (await seatMap(trip, 0, 3).expect(200)).body as SeatMapBody;
      expect(anonymous.genderRule).toEqual({ enabled: true, applied: false });
      expect(stateOf(anonymous, '3B')).toBe('FREE');

      // Das Geschlecht anderer Fahrgäste steht nie in der Antwort.
      for (const body of [female, male, anonymous]) {
        expect(JSON.stringify(body)).not.toMatch(/FEMALE|MALE/);
      }
    });

    it('prüft die Regel nicht, wenn die Fahrt sie nicht aktiviert hat', async () => {
      const day = dayFromNow(3);
      const fixture = await createSearchFixture(t.prisma, { genderRuleEnabled: false });
      const trip = await createSearchTrip(t.prisma, fixture, {
        departureAt: localTime(day, 8),
        genderRuleEnabled: false,
      });
      await occupy(trip, '3A', 0, 3, 'MALE');
      const body = (await seatMap(trip, 0, 3, 'FEMALE').expect(200)).body as SeatMapBody;
      expect(body.genderRule).toEqual({ enabled: false, applied: false });
      expect(stateOf(body, '3B')).toBe('FREE');
    });

    it('lehnt eine ungültige Teilstrecke ab', async () => {
      const day = dayFromNow(3);
      const fixture = await createSearchFixture(t.prisma);
      const trip = await createSearchTrip(t.prisma, fixture, { departureAt: localTime(day, 8) });
      const other = await createSearchTrip(t.prisma, fixture, { departureAt: localTime(day, 9) });

      expect((await seatMap(trip, 3, 1).expect(400)).body).toMatchObject({
        code: 'INVALID_SEGMENT',
      });
      expect((await seatMap(trip, 2, 2).expect(400)).body).toMatchObject({
        code: 'INVALID_SEGMENT',
      });
      const foreign = await t
        .http()
        .get(`/api/v1/trips/${trip.tripId}/seat-map`)
        .query({ fromStopId: other.tripStopIds[0], toStopId: trip.tripStopIds[3] })
        .expect(400);
      expect(foreign.body).toMatchObject({ code: 'INVALID_SEGMENT' });
    });

    it('meldet unbekannte Fahrten und ungültige Eingaben', async () => {
      const unknown = await t
        .http()
        .get('/api/v1/trips/0199f7a4-5c2e-7d3a-9b1e-2f4c6a8d0e12/seat-map')
        .query({
          fromStopId: '0199f7a4-5c2e-7d3a-9b1e-2f4c6a8d0e13',
          toStopId: '0199f7a4-5c2e-7d3a-9b1e-2f4c6a8d0e14',
        })
        .expect(404);
      expect(unknown.body).toMatchObject({ code: 'TRIP_NOT_FOUND' });

      const badId = await t
        .http()
        .get('/api/v1/trips/nicht-da/seat-map')
        .query({
          fromStopId: '0199f7a4-5c2e-7d3a-9b1e-2f4c6a8d0e13',
          toStopId: '0199f7a4-5c2e-7d3a-9b1e-2f4c6a8d0e14',
        })
        .expect(400);
      expect(badId.body).toMatchObject({ code: 'VALIDATION_FAILED' });

      const badGender = await t
        .http()
        .get('/api/v1/trips/0199f7a4-5c2e-7d3a-9b1e-2f4c6a8d0e12/seat-map')
        .query({
          fromStopId: '0199f7a4-5c2e-7d3a-9b1e-2f4c6a8d0e13',
          toStopId: '0199f7a4-5c2e-7d3a-9b1e-2f4c6a8d0e14',
          gender: 'OTHER',
        })
        .expect(400);
      expect(badGender.body).toMatchObject({
        code: 'VALIDATION_FAILED',
        errors: [{ path: 'gender', rule: 'invalid_value' }],
      });
    });
  });

  describe('mit dem Demo-Seed', () => {
    it('findet Homs → Aleppo inklusive der Nachtfahrt vom Vortag 23:00', async () => {
      const now = new Date();
      const seeded = await seedDemo(t.prisma, { now });
      // Übermorgen: Die Nachtfahrt von morgen hat dann sicher noch offenen Verkauf.
      const tomorrow = nextDay(nextDay(localDateInDamascus(now)));
      const cities = await t.prisma.city.findMany({
        where: { slug: { in: ['homs', 'aleppo', 'damascus'] } },
        select: { id: true, slug: true },
      });
      const city = (slug: string): string => cities.find((c) => c.slug === slug)!.id;

      const res = await t
        .http()
        .get('/api/v1/trips/search')
        .query({ from: city('homs'), to: city('aleppo'), date: tomorrow })
        .expect(200);
      const body = res.body as SearchBody;
      expect(body.items.map((item) => item.departureAt)).toEqual([
        localTime(tomorrow, 1, 10).toISOString(),
        localTime(tomorrow, 9, 10).toISOString(),
        localTime(tomorrow, 17, 10).toISOString(),
      ]);
      expect(seeded.tripIds).toContain(body.items[0]!.tripId);
      for (const item of body.items) {
        expect(item.fare).toEqual({ amountMinor: 40_000, currency: 'SYP' });
        expect(item.freeSeats).toEqual({ count: 9, capped: true });
      }

      const first = body.items[0]!;
      const map = await t
        .http()
        .get(`/api/v1/trips/${first.tripId}/seat-map`)
        .query({
          fromStopId: first.from.tripStopId,
          toStopId: first.to.tripStopId,
          gender: 'FEMALE',
        })
        .expect(200);
      const seatMapBody = map.body as SeatMapBody;
      expect(stateOf(seatMapBody, '9A')).toBe('BLOCKED');
      expect(stateOf(seatMapBody, '9B')).toBe('NOT_ONLINE');
      expect(stateOf(seatMapBody, '10D')).toBe('NOT_ONLINE');
      expect(stateOf(seatMapBody, '1A')).toBe('FREE');
      expect(stateOf(seatMapBody, '11C')).toBe('FREE');
    });
  });
});
