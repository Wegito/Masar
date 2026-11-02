import { randomUUID } from 'node:crypto';

import type pg from 'pg';

import type { PrismaClient } from '../../src/generated/prisma/client.js';
import type { TestApp } from './app.js';
import type { TripFixture } from './inventory.js';
import {
  createSearchFixture,
  createSearchTrip,
  type SearchFixture,
  type SearchFixtureOptions,
  type SearchTripOptions,
} from './search.js';

/**
 * Bausteine für Tests des Buchungskerns (Schritt 1.3). Fahrten entstehen über die Helfer der Suche
 * (vier Halte, 45-Sitzer mit Nachbarpaaren, Tarife je Paar), damit Buchung und Sitzplan dieselben
 * Daten sehen.
 */

export interface BookableTrip {
  fixture: SearchFixture;
  trip: TripFixture;
  departureAt: Date;
}

/** Fahrt in drei Tagen um diese Zeit; Firma und Kontingent nach Wunsch. */
export async function createBookableTrip(
  prisma: PrismaClient,
  options: {
    fixture?: SearchFixtureOptions;
    trip?: Partial<SearchTripOptions>;
    company?: {
      requireNationalId?: boolean;
      cashDeadlineMinutes?: number;
      holdMinutes?: number;
    };
    /** Stornoregel der Route; ohne Angabe: erlaubt, ohne Stufen. */
    policy?: {
      allowPassengerCancel?: boolean;
      rules?: { minMinutesBeforeDeparture: number; feeBps: number }[];
    };
    commissionRateBps?: number;
    /** Barfrist der Fahrt; Standard: keine (Firmeneinstellung gilt). */
    cashDeadlineAt?: Date;
  } = {},
): Promise<BookableTrip> {
  const fixture = await createSearchFixture(prisma, options.fixture);
  if (options.company !== undefined) {
    await prisma.company.update({ where: { id: fixture.companyId }, data: options.company });
  }
  if (options.policy !== undefined) {
    const route = await prisma.route.findUniqueOrThrow({
      where: { id: fixture.routeId },
      select: { cancellationPolicyId: true },
    });
    await prisma.cancellationPolicy.update({
      where: { id: route.cancellationPolicyId },
      data: {
        allowPassengerCancel: options.policy.allowPassengerCancel ?? true,
        rules: { create: options.policy.rules ?? [] },
      },
    });
  }
  if (options.commissionRateBps !== undefined) {
    await prisma.commissionRate.create({
      data: {
        companyId: fixture.companyId,
        rateBps: options.commissionRateBps,
        validFrom: new Date('2020-01-01T00:00:00.000Z'),
      },
    });
  }
  const departureAt = options.trip?.departureAt ?? new Date(Date.now() + 3 * 24 * 3_600_000);
  const trip = await createSearchTrip(prisma, fixture, { ...options.trip, departureAt });
  if (options.cashDeadlineAt !== undefined) {
    await prisma.trip.update({
      where: { id: trip.tripId },
      data: { cashDeadlineAt: options.cashDeadlineAt },
    });
  }
  return { fixture, trip, departureAt };
}

let phoneCounter = 100_000;
/** Jede Buchung eine eigene, gültige syrische Mobilnummer, damit das Limit je Telefon nicht greift. */
export function nextPhone(): string {
  phoneCounter += 1;
  return `+9639330${String(phoneCounter).slice(-5)}`;
}

export interface PassengerInput {
  label: string;
  gender?: 'FEMALE' | 'MALE';
  fullName?: string;
  nationalId?: string;
}

export function bookingBody(
  bookable: BookableTrip,
  input: {
    passengers: PassengerInput[];
    from?: number;
    to?: number;
    phone?: string;
    email?: string;
    name?: string;
  },
): Record<string, unknown> {
  const { trip } = bookable;
  return {
    tripId: trip.tripId,
    fromStopId: trip.tripStopIds[input.from ?? 0],
    toStopId: trip.tripStopIds[input.to ?? 3],
    locale: 'en',
    contact: {
      name: input.name ?? 'Lina Haddad',
      phone: input.phone ?? nextPhone(),
      ...(input.email === undefined ? {} : { email: input.email }),
    },
    passengers: input.passengers.map((passenger) => ({
      seatId: trip.seatIdByLabel.get(passenger.label) ?? passenger.label,
      fullName: passenger.fullName ?? 'Lina Haddad',
      ...(passenger.gender === undefined ? {} : { gender: passenger.gender }),
      ...(passenger.nationalId === undefined ? {} : { nationalId: passenger.nationalId }),
    })),
  };
}

export function postBooking(
  t: TestApp,
  body: Record<string, unknown>,
  idempotencyKey: string = randomUUID(),
): ReturnType<ReturnType<TestApp['http']>['post']> {
  return t.http().post('/api/v1/bookings').set('Idempotency-Key', idempotencyKey).send(body);
}

export interface HeldBooking {
  id: string;
  bookingCode: string;
  manageToken: string;
  status: string;
}

/** Hält Sitze über die API und erwartet 201. */
export async function hold(
  t: TestApp,
  bookable: BookableTrip,
  input: Parameters<typeof bookingBody>[1],
): Promise<HeldBooking> {
  const res = await postBooking(t, bookingBody(bookable, input));
  if (res.status !== 201) {
    throw new Error(`Hold fehlgeschlagen: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const body = res.body as { booking: HeldBooking; manageToken: string };
  return { ...body.booking, manageToken: body.manageToken };
}

export function guestPost(
  t: TestApp,
  booking: { id: string; manageToken: string },
  action: 'reserve-cash' | 'cancel',
): ReturnType<ReturnType<TestApp['http']>['post']> {
  return t
    .http()
    .post(`/api/v1/bookings/${booking.id}/${action}`)
    .set('X-Manage-Token', booking.manageToken);
}

/** Status und Zahl der Belegungen einer Buchung, direkt aus der Datenbank. */
export async function bookingState(
  prisma: PrismaClient,
  bookingId: string,
): Promise<{ status: string; occupations: number; tickets: string[] }> {
  const booking = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: {
      status: true,
      _count: { select: { occupations: true } },
      tickets: { select: { status: true } },
    },
  });
  return {
    status: booking.status,
    occupations: booking._count.occupations,
    tickets: booking.tickets.map((ticket) => ticket.status).sort(),
  };
}

/**
 * Wartet, bis mindestens `count` Verbindungen der API (application_name `masar-api`) in dieser
 * Datenbank auf eine Sperre warten. Die PID einer Pool-Verbindung kennt der Test nicht vorab.
 */
export async function waitUntilApiBlocked(observer: pg.Client, count: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const { rows } = await observer.query<{ waiting: string }>(
      `SELECT count(*) AS waiting FROM pg_stat_activity
       WHERE datname = current_database() AND application_name = 'masar-api'
         AND wait_event_type = 'Lock'`,
    );
    if (Number(rows[0]?.waiting ?? 0) >= count) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Nach 5 s warten nicht ${count} API-Verbindungen auf eine Sperre`);
}
