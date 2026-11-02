import { localDateInDamascus } from '@masar/shared';

import type { PrismaClient, TripStatus } from '../../src/generated/prisma/client.js';
import { generateSeatLayout } from '../../src/modules/fleet/domain/seat-layout-generator.js';
import type { TripFixture } from './inventory.js';

/**
 * Bausteine für Tests von Suche und Sitzplan (Schritt 1.2): eine Firma mit Route über vier eigene
 * Städte, Tarifen je Haltestellenpaar und einem 45-Sitzer mit Nachbarpaaren. Fahrten legt
 * {@link createSearchTrip} einzeln an, damit jeder Test Zeiten, Status und Kontingent wählt.
 */

let counter = 0;
function unique(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

/** Minuten ab Abfahrt am Start bis zur Abfahrt (bzw. Ankunft am letzten Halt) je Position. */
export const STOP_OFFSETS_MINUTES = [0, 120, 190, 320] as const;
/** Standard-Tarife in Minor-Units je Paar `von-bis`. */
export const DEFAULT_FARES: Record<string, number> = {
  '0-1': 25_000,
  '0-2': 35_000,
  '0-3': 60_000,
  '1-2': 15_000,
  '1-3': 40_000,
  '2-3': 30_000,
};

export interface SearchFixture {
  companyId: string;
  routeId: string;
  seatLayoutId: string;
  /** Städte nach Position 0 bis 3 (z. B. Damaskus, Homs, Hama, Aleppo). */
  cityIds: string[];
  stationIds: string[];
  routeStopIds: string[];
  seatIdByLabel: Map<string, string>;
}

export interface SearchFixtureOptions {
  genderRuleEnabled?: boolean;
  /** Tarife je Paar; fehlende Paare haben keinen Tarif. */
  fares?: Record<string, number>;
  /** Erster Gültigkeitstag der Tarife (`YYYY-MM-DD`), Standard: 2020-01-01. */
  fareValidFrom?: string;
}

export async function createSearchFixture(
  prisma: PrismaClient,
  options: SearchFixtureOptions = {},
): Promise<SearchFixture> {
  const slug = unique('search');
  const company = await prisma.company.create({
    data: {
      slug,
      nameAr: `شركة ${slug}`,
      nameEn: `Company ${slug}`,
      genderRuleEnabled: options.genderRuleEnabled ?? true,
    },
    select: { id: true },
  });
  const cityIds: string[] = [];
  const stationIds: string[] = [];
  for (const index of [0, 1, 2, 3]) {
    const city = await prisma.city.create({
      data: { slug: unique(`city${index}`), nameAr: `مدينة ${index}`, nameEn: `City ${index}` },
      select: { id: true },
    });
    const station = await prisma.station.create({
      data: { cityId: city.id, nameAr: `محطة ${index}`, nameEn: `Station ${index}` },
      select: { id: true },
    });
    cityIds.push(city.id);
    stationIds.push(station.id);
  }
  const policy = await prisma.cancellationPolicy.create({
    data: { companyId: company.id, name: 'Test' },
    select: { id: true },
  });
  const route = await prisma.route.create({
    data: {
      companyId: company.id,
      cancellationPolicyId: policy.id,
      nameAr: 'خط',
      nameEn: 'Line',
    },
    select: { id: true },
  });
  const routeStopIds: string[] = [];
  for (const [seq, stationId] of stationIds.entries()) {
    const stop = await prisma.routeStop.create({
      data: { routeId: route.id, stationId, seq },
      select: { id: true },
    });
    routeStopIds.push(stop.id);
  }
  for (const [pair, amountMinor] of Object.entries(options.fares ?? DEFAULT_FARES)) {
    const [from, to] = pair.split('-').map(Number) as [number, number];
    await prisma.fare.create({
      data: {
        routeId: route.id,
        fromRouteStopId: routeStopIds[from]!,
        toRouteStopId: routeStopIds[to]!,
        amountMinor,
        currency: 'SYP',
        validFrom: new Date(`${options.fareValidFrom ?? '2020-01-01'}T00:00:00.000Z`),
      },
    });
  }

  const layout = await prisma.seatLayout.create({
    data: {
      companyId: company.id,
      name: unique('layout'),
      pattern: 'TWO_PLUS_TWO',
      status: 'ACTIVE',
    },
    select: { id: true },
  });
  const generated = generateSeatLayout({ pattern: '2+2', rows: 10, backBench: 5 });
  await prisma.seat.createMany({
    data: generated.seats.map((seat) => ({ layoutId: layout.id, ...seat })),
  });
  const seats = await prisma.seat.findMany({
    where: { layoutId: layout.id },
    select: { id: true, label: true },
  });
  const seatIdByLabel = new Map(seats.map((seat) => [seat.label, seat.id]));
  const id = (label: string): string => seatIdByLabel.get(label)!;
  await prisma.seatNeighbor.createMany({
    data: generated.neighbors.flatMap(([a, b]) => [
      { layoutId: layout.id, seatId: id(a), neighborSeatId: id(b) },
      { layoutId: layout.id, seatId: id(b), neighborSeatId: id(a) },
    ]),
  });

  return {
    companyId: company.id,
    routeId: route.id,
    seatLayoutId: layout.id,
    cityIds,
    stationIds,
    routeStopIds,
    seatIdByLabel,
  };
}

export interface SearchTripOptions {
  /** Abfahrt am Starthalt. */
  departureAt: Date;
  status?: TripStatus;
  genderRuleEnabled?: boolean;
  /** Standard: 30 Minuten vor Abfahrt. */
  onlineSalesCloseAt?: Date;
  /** Sitze im Online-Kontingent; Standard: alle. */
  onlineLabels?: readonly string[];
  blockedLabels?: readonly string[];
}

/**
 * Fahrt mit Halten nach {@link STOP_OFFSETS_MINUTES}. Das Ergebnis passt zu den Helfern aus
 * `inventory.ts` (`createHeldBooking`, `insertOccupation`).
 */
export async function createSearchTrip(
  prisma: PrismaClient,
  fixture: SearchFixture,
  options: SearchTripOptions,
): Promise<TripFixture> {
  const at = (minutes: number): Date => new Date(options.departureAt.getTime() + minutes * 60_000);
  const lastOffset = STOP_OFFSETS_MINUTES.at(-1)!;
  const trip = await prisma.trip.create({
    data: {
      companyId: fixture.companyId,
      routeId: fixture.routeId,
      seatLayoutId: fixture.seatLayoutId,
      serviceDate: new Date(`${localDateInDamascus(options.departureAt)}T00:00:00.000Z`),
      departureAt: options.departureAt,
      arrivalAt: at(lastOffset),
      status: options.status ?? 'SCHEDULED',
      onlineSalesCloseAt: options.onlineSalesCloseAt ?? at(-30),
      genderRuleEnabled: options.genderRuleEnabled ?? true,
    },
    select: { id: true },
  });
  const tripStopIds: string[] = [];
  for (const [seq, offset] of STOP_OFFSETS_MINUTES.entries()) {
    const isLast = seq === STOP_OFFSETS_MINUTES.length - 1;
    const stop = await prisma.tripStop.create({
      data: {
        tripId: trip.id,
        routeStopId: fixture.routeStopIds[seq]!,
        stationId: fixture.stationIds[seq]!,
        seq,
        // Zehn Minuten Standzeit an Zwischenhalten.
        arrivalAt: seq === 0 ? null : at(offset - (isLast ? 0 : 10)),
        departureAt: isLast ? null : at(offset),
      },
      select: { id: true },
    });
    tripStopIds.push(stop.id);
  }
  const online = options.onlineLabels === undefined ? null : new Set(options.onlineLabels);
  const blocked = new Set(options.blockedLabels ?? []);
  await prisma.tripSeat.createMany({
    data: [...fixture.seatIdByLabel].map(([label, seatId]) => ({
      tripId: trip.id,
      seatId,
      seatLayoutId: fixture.seatLayoutId,
      onlineSellable: online === null || online.has(label),
      blocked: blocked.has(label),
    })),
  });
  return {
    companyId: fixture.companyId,
    tripId: trip.id,
    routeId: fixture.routeId,
    routeStopIds: fixture.routeStopIds,
    seatLayoutId: fixture.seatLayoutId,
    tripStopIds,
    seatIdByLabel: fixture.seatIdByLabel,
  };
}
