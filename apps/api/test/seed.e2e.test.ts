import { localDateInDamascus, SYRIA_TIME_ZONE } from '@masar/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  DEMO_COMPANY_SLUG,
  DEMO_DAYS,
  DEMO_DEPARTURES,
  damascusLocalToUtc,
  seedDemo,
} from '../prisma/seed/demo.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { resetDatabase } from './helpers/app.js';
import { createAppPrisma } from './helpers/inventory.js';

/** Fester Bezugszeitpunkt: 2026-11-02, 12:00 in Damaskus. */
const NOW = damascusLocalToUtc('2026-11-02', '12:00');

function damascusTime(instant: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: SYRIA_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant);
}

describe('Seed mit fiktiver Firma (db:seed)', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    await resetDatabase();
    prisma = createAppPrisma();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('legt Firma, Route, Tarife, 45-Sitzer und Fahrten für sieben Tage an', async () => {
    const result = await seedDemo(prisma, { now: NOW });
    const tripCount = DEMO_DAYS * DEMO_DEPARTURES.length;
    expect(result.createdTrips).toBe(tripCount);

    const company = await prisma.company.findUniqueOrThrow({ where: { slug: DEMO_COMPANY_SLUG } });
    expect(company.nameEn).toMatch(/demo/i);
    expect(await prisma.city.count()).toBe(4);
    expect(await prisma.routeStop.count({ where: { routeId: result.routeId } })).toBe(4);

    const fares = await prisma.fare.findMany({ where: { routeId: result.routeId } });
    expect(fares).toHaveLength(6);
    expect(fares.every((fare) => fare.currency === 'SYP' && fare.amountMinor % 100 === 0)).toBe(
      true,
    );

    expect(await prisma.seat.count({ where: { layoutId: result.seatLayoutId } })).toBe(45);
    // 10 Reihen mit je zwei Paaren plus Kette der Hinterbank (4 Paare), je in beiden Richtungen.
    expect(await prisma.seatNeighbor.count({ where: { layoutId: result.seatLayoutId } })).toBe(48);

    expect(await prisma.trip.count({ where: { companyId: company.id } })).toBe(tripCount);
    expect(await prisma.tripStop.count()).toBe(tripCount * 4);
    expect(await prisma.tripSeat.count()).toBe(tripCount * 45);
    expect(await prisma.booking.count()).toBe(0);
  });

  it('ist idempotent: ein zweiter Lauf legt nichts Neues an', async () => {
    const counts = async () => ({
      seats: await prisma.seat.count(),
      neighbors: await prisma.seatNeighbor.count(),
      fares: await prisma.fare.count(),
      trips: await prisma.trip.count(),
      tripSeats: await prisma.tripSeat.count(),
      stations: await prisma.station.count(),
      rules: await prisma.cancellationPolicyRule.count(),
    });
    const before = await counts();
    const result = await seedDemo(prisma, { now: NOW });
    expect(result.createdTrips).toBe(0);
    expect(await counts()).toEqual(before);
  });

  it('speichert jedes Nachbarpaar in beiden Richtungen; der mittlere Banksitz hat zwei Nachbarn', async () => {
    const asymmetric = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM seat_neighbor a
       WHERE NOT EXISTS (SELECT 1 FROM seat_neighbor b
                          WHERE b.seat_id = a.neighbor_seat_id AND b.neighbor_seat_id = a.seat_id)`;
    expect(asymmetric[0]?.n).toBe(0n);

    const middle = await prisma.seat.findFirstOrThrow({
      where: { label: '11C' },
      include: { neighbors: { include: { neighborSeat: { select: { label: true } } } } },
    });
    expect(middle.side).toBe('BENCH');
    expect(middle.neighbors.map((n) => n.neighborSeat.label).sort()).toEqual(['11B', '11D']);
  });

  it('setzt das Kontingent ausdrücklich: Reihen 9 und 10 am Schalter, 9A gesperrt', async () => {
    const trip = await prisma.trip.findFirstOrThrow({ orderBy: { departureAt: 'asc' } });
    const seats = await prisma.tripSeat.findMany({
      where: { tripId: trip.id },
      include: { seat: { select: { label: true } } },
    });
    expect(seats.filter((s) => s.onlineSellable)).toHaveLength(37);
    expect(seats.filter((s) => s.blocked).map((s) => s.seat.label)).toEqual(['9A']);
  });

  it('rechnet Abfahrten aus Ortszeit Asia/Damascus und speichert UTC', async () => {
    const trips = await prisma.trip.findMany({
      orderBy: { departureAt: 'asc' },
      include: { stops: { orderBy: { seq: 'asc' } } },
    });
    const first = trips[0]!;
    expect(localDateInDamascus(first.departureAt)).toBe('2026-11-02');
    expect(damascusTime(first.departureAt)).toBe('07:00');
    expect(first.serviceDate.toISOString().slice(0, 10)).toBe('2026-11-02');
    expect(first.onlineSalesCloseAt.getTime()).toBe(first.departureAt.getTime() - 30 * 60_000);

    // Nachtfahrt um 23:00: Fahrtag bleibt der Abfahrtstag, Homs wird am Folgetag erreicht.
    const night = trips.find((trip) => damascusTime(trip.departureAt) === '23:00')!;
    expect(night.serviceDate.toISOString().slice(0, 10)).toBe('2026-11-02');
    const homs = night.stops[1]!;
    expect(localDateInDamascus(homs.arrivalAt!)).toBe('2026-11-03');
    expect(night.stops[0]!.arrivalAt).toBeNull();
    expect(night.stops[3]!.departureAt).toBeNull();
    expect(night.arrivalAt).toEqual(night.stops[3]!.arrivalAt);
  });
});
