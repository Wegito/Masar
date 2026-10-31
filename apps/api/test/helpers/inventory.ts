import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { generateSeatLayout } from '../../src/modules/fleet/domain/seat-layout.js';
import { insertSeatLayout } from '../../src/modules/fleet/seat-layout.repository.js';
import { planTrip } from '../../src/modules/trips/domain/trip-plan.js';
import { insertTrip } from '../../src/modules/trips/trip.repository.js';

/**
 * Eine Firma mit Route Damaskus → Homs → Hama → Aleppo (seq 0 bis 3), einem kleinen Sitzplan
 * 2+2 mit zwei Reihen (Sitze 1 bis 8) und einer Fahrt darauf. Für Tests der Datenbankregeln und
 * später der Suche und des Buchungskerns. Namen sind eindeutig, damit mehrere Fixtures nebeneinander
 * in einer Datenbank liegen können.
 */
export interface InventoryFixture {
  companyId: string;
  routeId: string;
  routeStopIds: string[];
  layoutId: string;
  seatIdByLabel: Map<string, string>;
  tripId: string;
}

export interface InventoryFixtureOptions {
  departureAt?: Date;
  genderRuleEnabled?: boolean;
}

export async function createInventoryFixture(
  prisma: PrismaClient,
  options: InventoryFixtureOptions = {},
): Promise<InventoryFixture> {
  const key = randomUUID().slice(0, 8);
  return prisma.$transaction(async (tx) => {
    const company = await tx.company.create({
      data: {
        slug: `fixture-${key}`,
        nameAr: `شركة ${key}`,
        nameEn: `Fixture ${key}`,
        genderRuleEnabled: options.genderRuleEnabled ?? true,
      },
      select: {
        id: true,
        genderRuleEnabled: true,
        onlineSalesCloseMinutes: true,
        cashDeadlineMinutes: true,
      },
    });
    const cityNames = ['damascus', 'homs', 'hama', 'aleppo'];
    const stationIds: string[] = [];
    for (const name of cityNames) {
      const city = await tx.city.create({
        data: { slug: `${name}-${key}`, nameAr: name, nameEn: name },
        select: { id: true },
      });
      const station = await tx.station.create({
        data: { slug: `${name}-station-${key}`, cityId: city.id, nameAr: name, nameEn: name },
        select: { id: true },
      });
      stationIds.push(station.id);
    }
    const route = await tx.route.create({
      data: { companyId: company.id, name: `Route ${key}` },
      select: { id: true },
    });
    const routeStops = await tx.routeStop.createManyAndReturn({
      data: stationIds.map((stationId, seq) => ({ routeId: route.id, stationId, seq })),
      select: { id: true, stationId: true, seq: true },
    });
    const layout = await insertSeatLayout(tx, {
      companyId: company.id,
      name: `Layout ${key}`,
      blueprint: generateSeatLayout({ pattern: 'TWO_PLUS_TWO', rows: 2, rearBench: false }),
    });
    const start = options.departureAt ?? new Date(Date.now() + 7 * 24 * 3_600_000);
    const offset = (minutes: number): Date => new Date(start.getTime() + minutes * 60_000);
    const plan = planTrip({
      routeStops: routeStops.map((s) => ({
        routeStopId: s.id,
        stationId: s.stationId,
        seq: s.seq,
      })),
      stopTimes: [
        { arrivalAt: null, departureAt: start },
        { arrivalAt: offset(120), departureAt: offset(130) },
        { arrivalAt: offset(170), departureAt: offset(180) },
        { arrivalAt: offset(300), departureAt: null },
      ],
      seats: layout.seats.map((s) => ({ seatId: s.id, label: s.label, isSellable: s.isSellable })),
      company,
    });
    const { tripId } = await insertTrip(tx, {
      companyId: company.id,
      routeId: route.id,
      seatLayoutId: layout.layoutId,
      status: 'SCHEDULED',
      plan,
    });
    return {
      companyId: company.id,
      routeId: route.id,
      // RETURNING garantiert keine Reihenfolge.
      routeStopIds: [...routeStops].sort((a, b) => a.seq - b.seq).map((s) => s.id),
      layoutId: layout.layoutId,
      seatIdByLabel: new Map(layout.seats.map((s) => [s.label, s.id])),
      tripId,
    };
  });
}

export function seatId(fixture: InventoryFixture, label: string): string {
  const id = fixture.seatIdByLabel.get(label);
  if (id === undefined) {
    throw new Error(`Sitz ${label} fehlt in der Fixture`);
  }
  return id;
}
