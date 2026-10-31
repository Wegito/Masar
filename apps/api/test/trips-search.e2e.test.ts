import { instantFromDamascusLocal } from '@masar/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestApp, resetDatabase, type TestApp } from './helpers/app.js';
import {
  createInventoryFixture,
  fixtureFareMinor,
  type InventoryFixture,
  occupySeatDirectly,
} from './helpers/inventory.js';

/**
 * Suche und Sitzplan über HTTP gegen die echte Testdatenbank (Schritt 1.2). Die Uhr der App steht
 * fest, damit „Online-Verkauf geschlossen“ und der Suchtag steuerbar sind.
 */

// Abfahrt 20.11. 23:00 in Damaskus; Homs um 01:10, Hama 02:00, Aleppo 04:00 am 21.11.
const NIGHT_DEPARTURE = instantFromDamascusLocal('2026-11-20', '23:00');

interface SearchBody {
  trips: { seats: { available: number; moreAvailable: boolean } }[];
}

interface SeatMapBody {
  genderRuleEnabled: boolean;
  seats: { label: string; state: string }[];
}

interface CitiesBody {
  cities: { slug: string }[];
}

const trips = (res: { body: unknown }) => (res.body as SearchBody).trips;

let testApp: TestApp;

beforeAll(async () => {
  testApp = await createTestApp();
});

afterAll(async () => {
  await testApp.app.close();
});

beforeEach(() => {
  testApp.resetRateLimits();
});

function search(fixture: InventoryFixture, fromIndex: number, toIndex: number, date: string) {
  return testApp
    .http()
    .get('/api/v1/trips/search')
    .query({ from: fixture.citySlugs[fromIndex], to: fixture.citySlugs[toIndex], date });
}

describe('Suche', () => {
  let trip: InventoryFixture;

  beforeAll(async () => {
    await resetDatabase();
    trip = await createInventoryFixture(testApp.prisma, {
      departureAt: NIGHT_DEPARTURE,
      withFares: true,
      rows: 3,
      offlineSeatLabels: ['1'],
      blockedSeatLabels: ['2'],
    });
  });

  it('findet die Fahrt ohne Anmeldung, mit Tarif, Halten und Zeiten', async () => {
    const res = await search(trip, 0, 3, '2026-11-20').expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(trips(res)).toHaveLength(1);
    expect(trips(res)[0]).toMatchObject({
      tripId: trip.tripId,
      genderRuleEnabled: true,
      from: { seq: 0, departureAt: NIGHT_DEPARTURE.toISOString() },
      to: { seq: 3 },
      fare: { amountMinor: fixtureFareMinor(0, 3), currency: 'SYP' },
    });
  });

  it('findet eine Teilstrecke ab Homs am Folgetag, weil der Bus Homs nach Mitternacht verlässt', async () => {
    const nextDay = await search(trip, 1, 3, '2026-11-21').expect(200);
    expect(trips(nextDay)).toHaveLength(1);
    expect(trips(nextDay)[0]).toMatchObject({
      from: { seq: 1 },
      to: { seq: 3 },
      fare: { amountMinor: fixtureFareMinor(1, 3) },
    });
    const serviceDay = await search(trip, 1, 3, '2026-11-20').expect(200);
    expect(trips(serviceDay)).toEqual([]);
  });

  it('bietet keine Fahrt gegen die Fahrtrichtung an', async () => {
    const res = await search(trip, 3, 0, '2026-11-21').expect(200);
    expect(trips(res)).toEqual([]);
  });

  it('zählt freie Plätze nur im Online-Kontingent und nur auf dem gewählten Segment, gekappt bei 9', async () => {
    // 12 Sitze, davon Sitz 1 nur am Schalter und Sitz 2 gesperrt: 10 online, angezeigt als 9+.
    const empty = await search(trip, 0, 3, '2026-11-20').expect(200);
    expect(trips(empty)[0]?.seats).toEqual({ available: 9, moreAvailable: true });

    await occupySeatDirectly(testApp.prisma, trip, '3', { fromSeq: 0, toSeq: 1 }, 'MALE');
    await occupySeatDirectly(testApp.prisma, trip, '4', { fromSeq: 0, toSeq: 3 }, 'MALE');
    // Damaskus → Aleppo: Sitze 3 und 4 belegt, 8 frei.
    const full = await search(trip, 0, 3, '2026-11-20').expect(200);
    expect(trips(full)[0]?.seats).toEqual({ available: 8, moreAvailable: false });
    // Homs → Aleppo: Sitz 3 ist ab Homs wieder frei, 9 frei.
    const partial = await search(trip, 1, 3, '2026-11-21').expect(200);
    expect(trips(partial)[0]?.seats).toEqual({ available: 9, moreAvailable: false });
  });

  it('blendet Fahrten aus, deren Online-Verkauf geschlossen ist', async () => {
    const clockOffset = NIGHT_DEPARTURE.getTime() - 20 * 60_000 - testApp.clock.now().getTime();
    testApp.clock.advance(clockOffset);
    try {
      const res = await search(trip, 0, 3, '2026-11-20').expect(200);
      expect(trips(res)).toEqual([]);
    } finally {
      testApp.clock.advance(-clockOffset);
    }
  });

  it('blendet Paare ohne gültigen Tarif aus', async () => {
    const noFares = await createInventoryFixture(testApp.prisma, { departureAt: NIGHT_DEPARTURE });
    const res = await search(noFares, 0, 3, '2026-11-20').expect(200);
    expect(trips(res)).toEqual([]);
  });

  it('blendet Entwürfe, abgesagte Fahrten und Fahrten gesperrter Firmen aus', async () => {
    const draft = await createInventoryFixture(testApp.prisma, {
      departureAt: NIGHT_DEPARTURE,
      withFares: true,
      tripStatus: 'DRAFT',
    });
    const cancelled = await createInventoryFixture(testApp.prisma, {
      departureAt: NIGHT_DEPARTURE,
      withFares: true,
      tripStatus: 'CANCELLED',
    });
    const suspended = await createInventoryFixture(testApp.prisma, {
      departureAt: NIGHT_DEPARTURE,
      withFares: true,
    });
    await testApp.prisma.company.update({
      where: { id: suspended.companyId },
      data: { status: 'SUSPENDED' },
    });
    for (const fixture of [draft, cancelled, suspended]) {
      const res = await search(fixture, 0, 3, '2026-11-20').expect(200);
      expect(trips(res)).toEqual([]);
    }
  });

  it.each([
    [{ from: 'damascus', to: 'aleppo', date: '2026-02-30' }],
    [{ from: 'damascus', to: 'damascus', date: '2026-11-20' }],
    [{ from: 'Damascus!', to: 'aleppo', date: '2026-11-20' }],
    [{ from: 'damascus', date: '2026-11-20' }],
  ])('lehnt ungültige Anfragen ab: %o', async (query) => {
    const res = await testApp.http().get('/api/v1/trips/search').query(query).expect(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('Sitzplan', () => {
  let trip: InventoryFixture;

  beforeAll(async () => {
    await resetDatabase();
    trip = await createInventoryFixture(testApp.prisma, {
      departureAt: NIGHT_DEPARTURE,
      withFares: true,
      offlineSeatLabels: ['7'],
      blockedSeatLabels: ['8'],
    });
    // Ein Mann auf Sitz 1 von Damaskus bis Hama, eine Frau auf Sitz 3 von Damaskus bis Homs.
    await occupySeatDirectly(testApp.prisma, trip, '1', { fromSeq: 0, toSeq: 2 }, 'MALE');
    await occupySeatDirectly(testApp.prisma, trip, '3', { fromSeq: 0, toSeq: 1 }, 'FEMALE');
  });

  function seatMap(query: Record<string, unknown>, tripId = trip.tripId) {
    return testApp.http().get(`/api/v1/trips/${tripId}/seat-map`).query(query);
  }

  function states(body: unknown): Record<string, string> {
    return Object.fromEntries((body as SeatMapBody).seats.map((s) => [s.label, s.state]));
  }

  it('zeigt einer Frau für Homs → Aleppo den Nachbarsitz des Mannes als nicht wählbar', async () => {
    const res = await seatMap({ fromSeq: 1, toSeq: 3, gender: 'FEMALE' }).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(states(res.body)).toEqual({
      '1': 'TAKEN',
      '2': 'NOT_FOR_YOU',
      '3': 'FREE',
      '4': 'FREE',
      '5': 'FREE',
      '6': 'FREE',
      '7': 'NOT_ONLINE',
      '8': 'BLOCKED',
    });
    expect(res.body).toMatchObject({
      genderRuleEnabled: true,
      from: { seq: 1 },
      to: { seq: 3 },
      fare: { amountMinor: fixtureFareMinor(1, 3), currency: 'SYP' },
      layout: { pattern: 'TWO_PLUS_TWO', rows: 2, columns: 5 },
    });
  });

  it('zeigt denselben Sitz einer Frau ab Hama als frei, weil der Mann dort aussteigt', async () => {
    const res = await seatMap({ fromSeq: 2, toSeq: 3, gender: 'FEMALE' }).expect(200);
    expect(states(res.body)).toMatchObject({ '1': 'FREE', '2': 'FREE' });
  });

  it('verrät das Geschlecht anderer Fahrgäste nie ausdrücklich', async () => {
    const res = await seatMap({ fromSeq: 0, toSeq: 3, gender: 'MALE' }).expect(200);
    expect(states(res.body)).toMatchObject({ '1': 'TAKEN', '3': 'TAKEN', '4': 'NOT_FOR_YOU' });
    expect(JSON.stringify(res.body)).not.toMatch(/FEMALE|"MALE"|gender"\s*:\s*"/);
  });

  it('verlangt das Geschlecht, wenn die Fahrt die Regel hat', async () => {
    const res = await seatMap({ fromSeq: 0, toSeq: 3 }).expect(400);
    expect(res.body).toMatchObject({ code: 'GENDER_REQUIRED' });
  });

  it('braucht kein Geschlecht, wenn die Firma die Regel ausgeschaltet hat', async () => {
    const noRule = await createInventoryFixture(testApp.prisma, {
      departureAt: NIGHT_DEPARTURE,
      withFares: true,
      genderRuleEnabled: false,
    });
    const res = await seatMap({ fromSeq: 0, toSeq: 3 }, noRule.tripId).expect(200);
    expect((res.body as SeatMapBody).genderRuleEnabled).toBe(false);
    expect(Object.values(states(res.body))).not.toContain('NOT_FOR_YOU');
  });

  it.each([
    [{ fromSeq: 2, toSeq: 1, gender: 'FEMALE' }],
    [{ fromSeq: 1, toSeq: 1, gender: 'FEMALE' }],
    [{ fromSeq: 0, toSeq: 4, gender: 'FEMALE' }],
  ])('lehnt ein ungültiges Segment ab: %o', async (query) => {
    const res = await seatMap(query).expect(400);
    expect(res.body).toMatchObject({ code: 'INVALID_SEGMENT' });
  });

  it('meldet eine unbekannte Fahrt und einen Entwurf gleich: 404', async () => {
    const draft = await createInventoryFixture(testApp.prisma, {
      departureAt: NIGHT_DEPARTURE,
      withFares: true,
      tripStatus: 'DRAFT',
    });
    for (const tripId of ['01a19324-0000-7000-8000-000000000000', draft.tripId]) {
      const res = await seatMap({ fromSeq: 0, toSeq: 3, gender: 'FEMALE' }, tripId).expect(404);
      expect(res.body).toMatchObject({ code: 'TRIP_NOT_FOUND' });
    }
  });

  it('meldet eine abgesagte Fahrt als nicht buchbar', async () => {
    const cancelled = await createInventoryFixture(testApp.prisma, {
      departureAt: NIGHT_DEPARTURE,
      withFares: true,
      tripStatus: 'CANCELLED',
    });
    const res = await seatMap({ fromSeq: 0, toSeq: 3, gender: 'FEMALE' }, cancelled.tripId).expect(
      409,
    );
    expect(res.body).toMatchObject({ code: 'TRIP_NOT_BOOKABLE' });
  });

  it('meldet geschlossenen Online-Verkauf', async () => {
    const clockOffset = NIGHT_DEPARTURE.getTime() - testApp.clock.now().getTime();
    testApp.clock.advance(clockOffset);
    try {
      const res = await seatMap({ fromSeq: 0, toSeq: 3, gender: 'FEMALE' }).expect(409);
      expect(res.body).toMatchObject({ code: 'SALES_CLOSED' });
    } finally {
      testApp.clock.advance(-clockOffset);
    }
  });

  it('meldet ein Segment ohne Tarif', async () => {
    const noFares = await createInventoryFixture(testApp.prisma, { departureAt: NIGHT_DEPARTURE });
    const res = await seatMap({ fromSeq: 0, toSeq: 3, gender: 'FEMALE' }, noFares.tripId).expect(
      409,
    );
    expect(res.body).toMatchObject({ code: 'NO_FARE_FOR_SEGMENT' });
  });

  it('lehnt eine Fahrt-ID ab, die keine UUID ist', async () => {
    const res = await seatMap({ fromSeq: 0, toSeq: 3, gender: 'FEMALE' }, 'abc').expect(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('Städte', () => {
  it('liefert nur Städte mit Haltestelle, ohne Anmeldung', async () => {
    await resetDatabase();
    const fixture = await createInventoryFixture(testApp.prisma);
    await testApp.prisma.city.create({ data: { slug: 'ohne-halt', nameAr: 'x', nameEn: 'x' } });
    const res = await testApp.http().get('/api/v1/cities').expect(200);
    expect((res.body as CitiesBody).cities.map((c) => c.slug).sort()).toEqual(
      [...fixture.citySlugs].sort(),
    );
  });
});
