import { randomBytes } from 'node:crypto';

import { BOOKING_CODE_ALPHABET } from '@masar/shared';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

import { PrismaClient } from '../../src/generated/prisma/client.js';
import { generateSeatLayout } from '../../src/modules/fleet/domain/seat-layout-generator.js';

/**
 * Bausteine für Tests des Inventars (Schritt 1.1). Alles läuft mit der Anwendungsrolle aus
 * DATABASE_URL, damit die Tests auch deren Rechte prüfen.
 */

export function appDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url === undefined) {
    throw new Error('DATABASE_URL fehlt (vitest.config.ts)');
  }
  return url;
}

export function createAppPrisma(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: appDatabaseUrl() }) });
}

/** Eigene, echte Datenbankverbindung (für SQLSTATE-Prüfungen und Nebenläufigkeit). */
export async function connectRaw(): Promise<pg.Client> {
  const client = new pg.Client({
    connectionString: appDatabaseUrl(),
    application_name: 'masar-test',
  });
  await client.connect();
  return client;
}

/** SQLSTATE und Constraint eines fehlgeschlagenen Aufrufs; wirft, wenn der Aufruf gelingt. */
export async function sqlError(
  promise: Promise<unknown>,
): Promise<{ code: string | undefined; constraint: string | undefined }> {
  try {
    await promise;
  } catch (error) {
    const e = error as { code?: string; constraint?: string };
    return { code: e.code, constraint: e.constraint };
  }
  throw new Error('Erwarteter Datenbankfehler blieb aus');
}

export function randomBookingCode(): string {
  return [...randomBytes(8)].map((byte) => BOOKING_CODE_ALPHABET[byte % 32]).join('');
}

let counter = 0;
function unique(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

export interface TripFixture {
  companyId: string;
  tripId: string;
  routeId: string;
  /** Routenhalte nach Position 0 bis 3. */
  routeStopIds: string[];
  seatLayoutId: string;
  /** Fahrthalte nach Position 0 bis 3. */
  tripStopIds: string[];
  seatIdByLabel: Map<string, string>;
}

/**
 * Firma mit Route über vier Halte, 45-Sitzer (2+2, zehn Reihen, Hinterbank mit fünf Sitzen) und
 * einer Fahrt, deren Kontingent alle Sitze online anbietet.
 */
export async function createTripFixture(prisma: PrismaClient): Promise<TripFixture> {
  const slug = unique('inv');
  const company = await prisma.company.create({
    data: { slug, nameAr: `شركة ${slug}`, nameEn: `Company ${slug}` },
    select: { id: true },
  });
  const companyId = company.id;
  const city = await prisma.city.create({
    data: { slug: unique('city'), nameAr: 'مدينة', nameEn: 'City' },
    select: { id: true },
  });
  const stations = await Promise.all(
    [0, 1, 2, 3].map((index) =>
      prisma.station.create({
        data: { cityId: city.id, nameAr: `محطة ${index}`, nameEn: `Stop ${index}` },
        select: { id: true },
      }),
    ),
  );
  const policy = await prisma.cancellationPolicy.create({
    data: { companyId, name: 'Test' },
    select: { id: true },
  });
  const route = await prisma.route.create({
    data: { companyId, cancellationPolicyId: policy.id, nameAr: 'خط', nameEn: 'Line' },
    select: { id: true },
  });
  const routeStops = [];
  for (const [seq, station] of stations.entries()) {
    routeStops.push(
      await prisma.routeStop.create({
        data: { routeId: route.id, stationId: station.id, seq },
        select: { id: true },
      }),
    );
  }

  const layout = await prisma.seatLayout.create({
    data: { companyId, name: unique('layout'), pattern: 'TWO_PLUS_TWO', status: 'ACTIVE' },
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

  const departureAt = new Date(Date.now() + 2 * 24 * 3_600_000);
  const trip = await prisma.trip.create({
    data: {
      companyId,
      routeId: route.id,
      seatLayoutId: layout.id,
      serviceDate: new Date(`${departureAt.toISOString().slice(0, 10)}T00:00:00.000Z`),
      departureAt,
      arrivalAt: new Date(departureAt.getTime() + 5 * 3_600_000),
      status: 'SCHEDULED',
      onlineSalesCloseAt: new Date(departureAt.getTime() - 30 * 60_000),
      genderRuleEnabled: true,
    },
    select: { id: true },
  });
  const tripStopIds = [];
  for (const [seq, routeStop] of routeStops.entries()) {
    tripStopIds.push(
      (
        await prisma.tripStop.create({
          data: {
            tripId: trip.id,
            routeStopId: routeStop.id,
            stationId: stations[seq]!.id,
            seq,
            departureAt: new Date(departureAt.getTime() + seq * 3_600_000),
          },
          select: { id: true },
        })
      ).id,
    );
  }
  await prisma.tripSeat.createMany({
    data: seats.map((seat) => ({
      tripId: trip.id,
      seatId: seat.id,
      seatLayoutId: layout.id,
      onlineSellable: true,
    })),
  });
  return {
    companyId,
    tripId: trip.id,
    routeId: route.id,
    routeStopIds: routeStops.map((stop) => stop.id),
    seatLayoutId: layout.id,
    tripStopIds,
    seatIdByLabel,
  };
}

export function seatId(fixture: TripFixture, label: string): string {
  const id = fixture.seatIdByLabel.get(label);
  if (id === undefined) {
    throw new Error(`Sitz ${label} fehlt`);
  }
  return id;
}

/**
 * Buchung im Status HELD mit einem Fahrgast je Sitz, aber ohne Belegung. Die Belegung schreiben
 * die Tests selbst, an der Anwendung vorbei.
 */
export async function createHeldBooking(
  prisma: PrismaClient,
  fixture: TripFixture,
  input: { fromSeq: number; toSeq: number; seats: string[]; gender?: 'FEMALE' | 'MALE' },
): Promise<{ bookingId: string; passengerIds: string[] }> {
  const booking = await prisma.booking.create({
    data: {
      companyId: fixture.companyId,
      tripId: fixture.tripId,
      bookingCode: randomBookingCode(),
      status: 'HELD',
      channel: 'ONLINE',
      fromTripStopId: fixture.tripStopIds[input.fromSeq]!,
      toTripStopId: fixture.tripStopIds[input.toSeq]!,
      fromSeq: input.fromSeq,
      toSeq: input.toSeq,
      // Platzhalter, keine echten Personendaten.
      contactName: 'Test Passenger',
      contactPhoneE164: '+963900000000',
      holdExpiresAt: new Date(Date.now() + 15 * 60_000),
      fareAmountMinor: 25_000,
      totalAmountMinor: 25_000 * input.seats.length,
      currency: 'SYP',
    },
    select: { id: true },
  });
  const passengerIds = [];
  for (const label of input.seats) {
    passengerIds.push(
      (
        await prisma.bookingPassenger.create({
          data: {
            bookingId: booking.id,
            tripId: fixture.tripId,
            seatId: seatId(fixture, label),
            fullName: 'Test Passenger',
            gender: input.gender ?? 'FEMALE',
          },
          select: { id: true },
        })
      ).id,
    );
  }
  return { bookingId: booking.id, passengerIds };
}

export interface OccupationInput {
  tripId: string;
  seatId: string;
  fromSeq: number;
  toSeq: number;
  bookingId: string;
  passengerId: string;
  gender?: 'FEMALE' | 'MALE' | null;
}

/** Belegung direkt per SQL, ohne Sperre und ohne Prüfung in der Anwendung. */
export function insertOccupation(
  client: pg.Client,
  input: OccupationInput,
): Promise<pg.QueryResult> {
  return client.query(
    `INSERT INTO seat_occupation
       (trip_id, seat_id, from_seq, to_seq, booking_id, booking_passenger_id, gender, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
    [
      input.tripId,
      input.seatId,
      input.fromSeq,
      input.toSeq,
      input.bookingId,
      input.passengerId,
      input.gender === undefined ? 'FEMALE' : input.gender,
    ],
  );
}

/**
 * Buchung direkt per SQL mit frei wählbarer Firma und Fahrt, um die zusammengesetzten
 * Fremdschlüssel an der Anwendung vorbei zu prüfen.
 */
export function insertBookingRaw(
  client: pg.Client,
  input: {
    companyId: string;
    tripId: string;
    fromTripStopId: string;
    toTripStopId: string;
    fromSeq: number;
    toSeq: number;
  },
): Promise<pg.QueryResult> {
  return client.query(
    `INSERT INTO booking
       (company_id, trip_id, booking_code, status, channel, from_trip_stop_id, to_trip_stop_id,
        from_seq, to_seq, contact_name, contact_phone_e164, hold_expires_at, fare_amount_minor,
        total_amount_minor, currency, updated_at)
     VALUES ($1, $2, $3, 'HELD', 'ONLINE', $4, $5, $6, $7, 'Test Passenger', '+963900000000',
             now() + interval '15 minutes', 25000, 25000, 'SYP', now())`,
    [
      input.companyId,
      input.tripId,
      randomBookingCode(),
      input.fromTripStopId,
      input.toTripStopId,
      input.fromSeq,
      input.toSeq,
    ],
  );
}

/** Wartet, bis die Verbindung mit dieser Backend-PID auf eine Sperre wartet. */
export async function waitUntilBlocked(observer: pg.Client, pid: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const { rows } = await observer.query<{ waiting: boolean }>(
      `SELECT wait_event_type = 'Lock' AS waiting FROM pg_stat_activity WHERE pid = $1`,
      [pid],
    );
    if (rows[0]?.waiting === true) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Verbindung ${pid} wartet nach 5 s nicht auf eine Sperre`);
}

export async function backendPid(client: pg.Client): Promise<number> {
  const { rows } = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
  return rows[0]!.pid;
}
