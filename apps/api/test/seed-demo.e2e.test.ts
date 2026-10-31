import { localDateInDamascus } from '@masar/shared';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { fromDbDate } from '../src/common/calendar-date.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import {
  assertSeedAllowed,
  DEMO_COMPANY_SLUG,
  grantDemoAgent,
  seedDemo,
} from '../src/scripts/demo-data.js';
import { resetDatabase } from './helpers/app.js';

/** Demo-Seed gegen die Testdatenbank, mit der Anwendungsrolle wie im echten Aufruf. */
describe('Demo-Seed', () => {
  let prisma: PrismaClient;
  const today = '2026-11-02';

  beforeAll(async () => {
    await resetDatabase();
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL as string }),
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function counts() {
    return {
      companies: await prisma.company.count(),
      cities: await prisma.city.count(),
      stations: await prisma.station.count(),
      routes: await prisma.route.count(),
      fares: await prisma.fare.count(),
      seats: await prisma.seat.count(),
      neighbors: await prisma.seatNeighbor.count(),
      buses: await prisma.bus.count(),
      trips: await prisma.trip.count(),
      tripStops: await prisma.tripStop.count(),
      tripSeats: await prisma.tripSeat.count(),
    };
  }

  it('legt eine fiktive Firma mit Katalog, Sitzplan und Fahrten für zwei Tage an', async () => {
    const result = await seedDemo(prisma, { today, days: 2 });
    expect(result.tripsCreated).toBe(10);
    expect(await counts()).toEqual({
      companies: 1,
      cities: 4,
      stations: 4,
      routes: 2,
      fares: 12,
      seats: 45,
      neighbors: 48,
      buses: 5,
      trips: 10,
      tripStops: 40,
      tripSeats: 450,
    });
  });

  it('ändert bei einem zweiten Lauf nichts', async () => {
    const before = await counts();
    const result = await seedDemo(prisma, { today, days: 2 });
    expect(result).toMatchObject({ tripsCreated: 0, tripsExisting: 10 });
    expect(await counts()).toEqual(before);
  });

  it('ergänzt bei einem längeren Zeitfenster nur die fehlenden Tage', async () => {
    const result = await seedDemo(prisma, { today, days: 3 });
    expect(result).toMatchObject({ tripsCreated: 5, tripsExisting: 10 });
  });

  it('setzt das Kontingent ausdrücklich: erste Reihe nur am Schalter, Sitz 45 gesperrt', async () => {
    const trip = await prisma.trip.findFirstOrThrow({
      select: {
        seats: {
          select: { onlineSellable: true, blocked: true, seat: { select: { label: true } } },
        },
      },
    });
    const byLabel = new Map(trip.seats.map((s) => [s.seat.label, s]));
    expect(byLabel.get('1')).toMatchObject({ onlineSellable: false, blocked: false });
    expect(byLabel.get('45')).toMatchObject({ onlineSellable: false, blocked: true });
    expect(trip.seats.filter((s) => s.onlineSellable)).toHaveLength(40);
  });

  it('enthält eine Nachtfahrt, die Homs erst am Folgetag erreicht', async () => {
    const night = await prisma.trip.findMany({
      where: { serviceDate: new Date(`${today}T00:00:00Z`), route: { name: 'Damascus – Aleppo' } },
      orderBy: { departureAt: 'desc' },
      take: 1,
      select: {
        serviceDate: true,
        departureAt: true,
        stops: { where: { seq: 1 }, select: { departureAt: true } },
      },
    });
    const trip = night[0];
    expect(trip).toBeDefined();
    expect(fromDbDate(trip!.serviceDate)).toBe(today);
    expect(localDateInDamascus(trip!.departureAt)).toBe(today);
    expect(localDateInDamascus(trip!.stops[0]!.departureAt!)).toBe('2026-11-03');
  });

  it('übernimmt die Firmeneinstellungen in jede Fahrt', async () => {
    const company = await prisma.company.findUniqueOrThrow({ where: { slug: DEMO_COMPANY_SLUG } });
    const trips = await prisma.trip.findMany({
      select: { genderRuleEnabled: true, departureAt: true, cashDeadlineAt: true },
    });
    for (const trip of trips) {
      expect(trip.genderRuleEnabled).toBe(company.genderRuleEnabled);
      expect(trip.departureAt.getTime() - trip.cashDeadlineAt.getTime()).toBe(
        company.cashDeadlineMinutes * 60_000,
      );
    }
  });

  it('legt einen Agenten der Demo-Firma ohne festes Passwort an, mit einmaligem Link im Fragment', async () => {
    const first = await grantDemoAgent(prisma, {
      email: 'Agent@Demo.Example',
      portalUrl: 'http://localhost:3002',
    });
    expect(first.setupLink).toMatch(
      /^http:\/\/localhost:3002\/ar\/auth\/reset-password#token=[A-Za-z0-9_-]{43}$/,
    );
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: 'agent@demo.example' },
      select: {
        id: true,
        passwordHash: true,
        memberships: { select: { role: true, company: { select: { slug: true } } } },
      },
    });
    expect(user.passwordHash).toBeNull();
    expect(user.memberships).toEqual([{ role: 'AGENT', company: { slug: DEMO_COMPANY_SLUG } }]);
    const second = await grantDemoAgent(prisma, {
      email: 'agent@demo.example',
      portalUrl: 'http://localhost:3002',
    });
    expect(second.userId).toBe(first.userId);
    expect(await prisma.passwordReset.count({ where: { userId: first.userId } })).toBe(2);
  });

  it('verweigert den Lauf in Produktion', () => {
    expect(() => assertSeedAllowed({ NODE_ENV: 'production' })).toThrow(/Produktion/);
    expect(() => assertSeedAllowed({ NODE_ENV: 'development' })).not.toThrow();
  });
});
