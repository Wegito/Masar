import { randomBytes, randomUUID } from 'node:crypto';

import { encodeBookingCode, type Gender } from '@masar/shared';

import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { generateSeatLayout } from '../../src/modules/fleet/domain/seat-layout.js';
import { insertSeatLayout } from '../../src/modules/fleet/seat-layout.repository.js';
import { planTrip } from '../../src/modules/trips/domain/trip-plan.js';
import { insertTrip } from '../../src/modules/trips/trip.repository.js';

/**
 * Eine Firma mit Route Damaskus → Homs → Hama → Aleppo (seq 0 bis 3), einem Sitzplan 2+2 (Standard
 * zwei Reihen, Sitze 1 bis 8; Nachbarn 1–2, 3–4, 5–6, 7–8) und einer Fahrt darauf. Für Tests der
 * Datenbankregeln, der Suche und des Buchungskerns. Namen sind eindeutig, damit mehrere Fixtures
 * nebeneinander in einer Datenbank liegen können.
 */
export interface InventoryFixture {
  companyId: string;
  routeId: string;
  routeStopIds: string[];
  /** Slugs der Städte in Routenreihenfolge (Damaskus, Homs, Hama, Aleppo). */
  citySlugs: string[];
  layoutId: string;
  seatIdByLabel: Map<string, string>;
  tripId: string;
  departureAt: Date;
}

export interface InventoryFixtureOptions {
  departureAt?: Date;
  genderRuleEnabled?: boolean;
  /** Reihen 2+2 ohne Hinterbank; Standard 2 (acht Sitze). */
  rows?: number;
  /** Tarife für alle Paare in Fahrtrichtung, gültig ab 2020 und unbefristet. */
  withFares?: boolean;
  offlineSeatLabels?: string[];
  blockedSeatLabels?: string[];
  tripStatus?: 'DRAFT' | 'SCHEDULED' | 'CANCELLED';
}

/** Tarif eines Paars in den Fixtures: 10.000 SYP je Abschnitt, in Minor-Units. */
export function fixtureFareMinor(fromSeq: number, toSeq: number): number {
  return (toSeq - fromSeq) * 1_000_000;
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
    const citySlugs = cityNames.map((name) => `${name}-${key}`);
    const stationIds: string[] = [];
    for (const [index, name] of cityNames.entries()) {
      const city = await tx.city.create({
        data: { slug: citySlugs[index] as string, nameAr: name, nameEn: name },
        select: { id: true },
      });
      const station = await tx.station.create({
        data: {
          slug: `${name}-station-${key}`,
          cityId: city.id,
          nameAr: `محطة ${name}`,
          nameEn: `${name} station`,
        },
        select: { id: true },
      });
      stationIds.push(station.id);
    }
    const route = await tx.route.create({
      data: { companyId: company.id, name: `Route ${key}` },
      select: { id: true },
    });
    const returned = await tx.routeStop.createManyAndReturn({
      data: stationIds.map((stationId, seq) => ({ routeId: route.id, stationId, seq })),
      select: { id: true, stationId: true, seq: true },
    });
    // RETURNING garantiert keine Reihenfolge.
    const routeStops = [...returned].sort((a, b) => a.seq - b.seq);
    if (options.withFares === true) {
      const fares = [];
      for (let from = 0; from < routeStops.length; from++) {
        for (let to = from + 1; to < routeStops.length; to++) {
          fares.push({
            routeId: route.id,
            fromRouteStopId: routeStops[from]?.id as string,
            toRouteStopId: routeStops[to]?.id as string,
            amountMinor: fixtureFareMinor(from, to),
            currency: 'SYP',
            validFrom: new Date('2020-01-01T00:00:00Z'),
          });
        }
      }
      await tx.fare.createMany({ data: fares });
    }
    const layout = await insertSeatLayout(tx, {
      companyId: company.id,
      name: `Layout ${key}`,
      blueprint: generateSeatLayout({
        pattern: 'TWO_PLUS_TWO',
        rows: options.rows ?? 2,
        rearBench: false,
      }),
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
      offlineSeatLabels: options.offlineSeatLabels,
      blockedSeatLabels: options.blockedSeatLabels,
      company,
    });
    const { tripId } = await insertTrip(tx, {
      companyId: company.id,
      routeId: route.id,
      seatLayoutId: layout.layoutId,
      status: options.tripStatus ?? 'SCHEDULED',
      plan,
    });
    return {
      companyId: company.id,
      routeId: route.id,
      routeStopIds: routeStops.map((s) => s.id),
      citySlugs,
      layoutId: layout.layoutId,
      seatIdByLabel: new Map(layout.seats.map((s) => [s.label, s.id])),
      tripId,
      departureAt: start,
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

export interface BookingRows {
  bookingId: string;
  passengerIdBySeatLabel: Map<string, string>;
}

/**
 * Legt eine Buchung mit Fahrgästen direkt in der Datenbank an, ohne Belegung und an jedem
 * Buchungsservice vorbei. Für Tests, die Datenbankregeln oder einen bestimmten Bestand brauchen.
 */
export async function insertBookingRows(
  prisma: PrismaClient,
  fixture: InventoryFixture,
  labels: string[],
  segment: { fromSeq: number; toSeq: number },
  gender: Gender | null,
): Promise<BookingRows> {
  const booking = await prisma.booking.create({
    data: {
      companyId: fixture.companyId,
      tripId: fixture.tripId,
      bookingCode: encodeBookingCode(randomBytes(5)),
      status: 'HELD',
      channel: 'ONLINE',
      fromSeq: segment.fromSeq,
      toSeq: segment.toSeq,
      contactName: 'Testperson',
      contactPhoneE164: '+963933000000',
      locale: 'ar',
      holdExpiresAt: new Date(Date.now() + 365 * 86_400_000),
      fareAmountMinor: 1_000_000,
      totalAmountMinor: 1_000_000 * labels.length,
      currency: 'SYP',
      manageTokenHash: randomUUID(),
      idempotencyKey: randomUUID(),
      requestFingerprint: 'test',
    },
    select: { id: true },
  });
  const passengerIdBySeatLabel = new Map<string, string>();
  for (const label of labels) {
    const passenger = await prisma.bookingPassenger.create({
      data: {
        bookingId: booking.id,
        tripId: fixture.tripId,
        seatId: seatId(fixture, label),
        fullName: 'Testperson',
        gender,
      },
      select: { id: true },
    });
    passengerIdBySeatLabel.set(label, passenger.id);
  }
  return { bookingId: booking.id, passengerIdBySeatLabel };
}

/**
 * Belegt einen Sitz direkt in der Datenbank, mit eigener Buchung, an jedem Buchungsservice vorbei.
 * Nur für Tests, die einen bestimmten Bestand brauchen.
 */
export async function occupySeatDirectly(
  prisma: PrismaClient,
  fixture: InventoryFixture,
  label: string,
  segment: { fromSeq: number; toSeq: number },
  gender: Gender | null,
): Promise<BookingRows> {
  const rows = await insertBookingRows(prisma, fixture, [label], segment, gender);
  await prisma.seatOccupation.create({
    data: {
      tripId: fixture.tripId,
      seatId: seatId(fixture, label),
      fromSeq: segment.fromSeq,
      toSeq: segment.toSeq,
      bookingId: rows.bookingId,
      bookingPassengerId: rows.passengerIdBySeatLabel.get(label) as string,
      gender,
    },
  });
  return rows;
}
