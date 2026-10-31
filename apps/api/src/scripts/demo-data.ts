import { addDaysToCalendarDate, fromMajor, instantFromDamascusLocal } from '@masar/shared';

import { toDbDate } from '../common/calendar-date.js';
import type { Env } from '../config/env.js';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { generateSeatLayout } from '../modules/fleet/domain/seat-layout.js';
import { insertSeatLayout, type StoredSeat } from '../modules/fleet/seat-layout.repository.js';
import { planTrip } from '../modules/trips/domain/trip-plan.js';
import { insertTrip } from '../modules/trips/trip.repository.js';

/**
 * Demo-Daten für Entwicklung und Vorführung (Roadmap 1.1, ADR 0007).
 *
 * Firma, Haltestellen, Busse und Preise sind erfunden. Echt sind nur die Städtenamen. Der Seed ist
 * idempotent: Ein zweiter Lauf ändert nichts, ein späterer Lauf ergänzt nur fehlende Fahrten im
 * Zeitfenster ab heute. Er enthält keine Personendaten.
 */

export const DEMO_COMPANY_SLUG = 'masar-demo-lines';
const LAYOUT_NAME = 'Standard 45';
const CURRENCY = 'SYP';

const CITIES = [
  { slug: 'damascus', nameAr: 'دمشق', nameEn: 'Damascus' },
  { slug: 'homs', nameAr: 'حمص', nameEn: 'Homs' },
  { slug: 'hama', nameAr: 'حماة', nameEn: 'Hama' },
  { slug: 'aleppo', nameAr: 'حلب', nameEn: 'Aleppo' },
] as const;

type CitySlug = (typeof CITIES)[number]['slug'];

const STATIONS: { slug: string; city: CitySlug; nameAr: string; nameEn: string }[] = [
  {
    slug: 'damascus-central',
    city: 'damascus',
    nameAr: 'كراج دمشق المركزي',
    nameEn: 'Damascus Central Garage',
  },
  { slug: 'homs-central', city: 'homs', nameAr: 'كراج حمص المركزي', nameEn: 'Homs Central Garage' },
  {
    slug: 'hama-central',
    city: 'hama',
    nameAr: 'كراج حماة المركزي',
    nameEn: 'Hama Central Garage',
  },
  {
    slug: 'aleppo-central',
    city: 'aleppo',
    nameAr: 'كراج حلب المركزي',
    nameEn: 'Aleppo Central Garage',
  },
];

/** Fiktive Preise in ganzen SYP je Haltestellenpaar, in beiden Richtungen gleich. */
const FARES_MAJOR: Record<string, number> = {
  'damascus-central|homs-central': 25_000,
  'damascus-central|hama-central': 35_000,
  'damascus-central|aleppo-central': 50_000,
  'homs-central|hama-central': 15_000,
  'homs-central|aleppo-central': 35_000,
  'hama-central|aleppo-central': 25_000,
};

/** Minuten ab Abfahrt am ersten Halt: Ankunft und Abfahrt je Halt. */
const STOP_OFFSETS: { arrival: number | null; departure: number | null }[] = [
  { arrival: null, departure: 0 },
  { arrival: 120, departure: 130 },
  { arrival: 170, departure: 180 },
  { arrival: 300, departure: null },
];

/**
 * Eine Abfahrt um 23:00 erreicht Homs nach Mitternacht. Damit lässt sich die Suche über den
 * Tageswechsel vorführen (docs/domaenenmodell.md, Suche und Tarif).
 */
const ROUTES = [
  {
    name: 'Damascus – Aleppo',
    stations: ['damascus-central', 'homs-central', 'hama-central', 'aleppo-central'],
    departures: [
      { time: '07:00', plate: 'DEMO-01' },
      { time: '15:00', plate: 'DEMO-02' },
      { time: '23:00', plate: 'DEMO-03' },
    ],
  },
  {
    name: 'Aleppo – Damascus',
    stations: ['aleppo-central', 'hama-central', 'homs-central', 'damascus-central'],
    departures: [
      { time: '08:00', plate: 'DEMO-04' },
      { time: '16:00', plate: 'DEMO-05' },
    ],
  },
];

/** Kontingent (ADR 0007): erste Reihe verkauft nur der Schalter, Sitz 45 bleibt gesperrt. */
const OFFLINE_SEATS = ['1', '2', '3', '4'];
const BLOCKED_SEATS = ['45'];

export interface SeedOptions {
  /** Erster Fahrtag `YYYY-MM-DD` in Damaskus, üblicherweise heute. */
  readonly today: string;
  /** Anzahl Tage ab `today`, für die Fahrten bestehen sollen. */
  readonly days: number;
}

export interface SeedResult {
  readonly companyId: string;
  readonly tripsCreated: number;
  readonly tripsExisting: number;
}

export function assertSeedAllowed(env: Pick<Env, 'NODE_ENV'>): void {
  if (env.NODE_ENV === 'production') {
    throw new Error('Der Demo-Seed läuft nie in Produktion');
  }
}

function fareKey(a: string, b: string): string {
  return FARES_MAJOR[`${a}|${b}`] === undefined ? `${b}|${a}` : `${a}|${b}`;
}

interface StaticData {
  companyId: string;
  company: {
    genderRuleEnabled: boolean;
    onlineSalesCloseMinutes: number;
    cashDeadlineMinutes: number;
  };
  layoutId: string;
  seats: StoredSeat[];
  busIdByPlate: Map<string, string>;
  routes: {
    name: string;
    id: string;
    stops: { routeStopId: string; stationId: string; seq: number }[];
  }[];
}

async function ensureStaticData(tx: Prisma.TransactionClient, today: string): Promise<StaticData> {
  const cityIds = new Map<string, string>();
  for (const city of CITIES) {
    const row = await tx.city.upsert({
      where: { slug: city.slug },
      update: {},
      create: city,
      select: { id: true },
    });
    cityIds.set(city.slug, row.id);
  }
  const stationIds = new Map<string, string>();
  for (const { city, ...station } of STATIONS) {
    const row = await tx.station.upsert({
      where: { slug: station.slug },
      update: {},
      create: { ...station, cityId: cityIds.get(city) as string },
      select: { id: true },
    });
    stationIds.set(station.slug, row.id);
  }

  const company = await tx.company.upsert({
    where: { slug: DEMO_COMPANY_SLUG },
    update: {},
    create: { slug: DEMO_COMPANY_SLUG, nameAr: 'خطوط مسار التجريبية', nameEn: 'Masar Demo Lines' },
    select: {
      id: true,
      genderRuleEnabled: true,
      onlineSalesCloseMinutes: true,
      cashDeadlineMinutes: true,
    },
  });

  const existingLayout = await tx.seatLayout.findUnique({
    where: { companyId_name_version: { companyId: company.id, name: LAYOUT_NAME, version: 1 } },
    select: { id: true, seats: { select: { id: true, label: true, isSellable: true } } },
  });
  const layout =
    existingLayout === null
      ? await insertSeatLayout(tx, {
          companyId: company.id,
          name: LAYOUT_NAME,
          blueprint: generateSeatLayout({ pattern: 'TWO_PLUS_TWO', rows: 10, rearBench: true }),
        })
      : { layoutId: existingLayout.id, seats: existingLayout.seats };

  const busIdByPlate = new Map<string, string>();
  for (const plate of ROUTES.flatMap((r) => r.departures.map((d) => d.plate))) {
    const bus = await tx.bus.upsert({
      where: { companyId_plate: { companyId: company.id, plate } },
      update: {},
      create: { companyId: company.id, plate, seatLayoutId: layout.layoutId },
      select: { id: true },
    });
    busIdByPlate.set(plate, bus.id);
  }

  const routes: StaticData['routes'] = [];
  for (const definition of ROUTES) {
    let route = await tx.route.findUnique({
      where: { companyId_name: { companyId: company.id, name: definition.name } },
      select: { id: true, stops: { select: { id: true, stationId: true, seq: true } } },
    });
    if (route === null) {
      const created = await tx.route.create({
        data: { companyId: company.id, name: definition.name },
        select: { id: true },
      });
      const stops = await tx.routeStop.createManyAndReturn({
        data: definition.stations.map((slug, seq) => ({
          routeId: created.id,
          stationId: stationIds.get(slug) as string,
          seq,
        })),
        select: { id: true, stationId: true, seq: true },
      });
      // RETURNING garantiert keine Reihenfolge; Zuordnung deshalb über die Position.
      const stopIdBySeq = new Map(stops.map((stop) => [stop.seq, stop.id]));
      // Tarife für jedes Paar in Fahrtrichtung, gültig ab dem ersten Seed-Lauf, unbefristet.
      const fares: Prisma.FareCreateManyInput[] = [];
      for (let from = 0; from < definition.stations.length; from++) {
        for (let to = from + 1; to < definition.stations.length; to++) {
          const a = definition.stations[from] as string;
          const b = definition.stations[to] as string;
          fares.push({
            routeId: created.id,
            fromRouteStopId: stopIdBySeq.get(from) as string,
            toRouteStopId: stopIdBySeq.get(to) as string,
            amountMinor: fromMajor(FARES_MAJOR[fareKey(a, b)] as number, CURRENCY).amountMinor,
            currency: CURRENCY,
            validFrom: toDbDate(today),
          });
        }
      }
      await tx.fare.createMany({ data: fares });
      route = { id: created.id, stops };
    }
    routes.push({
      name: definition.name,
      id: route.id,
      stops: route.stops.map((s) => ({ routeStopId: s.id, stationId: s.stationId, seq: s.seq })),
    });
  }

  return {
    companyId: company.id,
    company,
    layoutId: layout.layoutId,
    seats: layout.seats,
    busIdByPlate,
    routes,
  };
}

export async function seedDemo(prisma: PrismaClient, options: SeedOptions): Promise<SeedResult> {
  if (!Number.isInteger(options.days) || options.days < 1 || options.days > 60) {
    throw new RangeError('days muss zwischen 1 und 60 liegen');
  }
  const data = await prisma.$transaction((tx) => ensureStaticData(tx, options.today));

  let tripsCreated = 0;
  let tripsExisting = 0;
  for (let day = 0; day < options.days; day++) {
    const date = addDaysToCalendarDate(options.today, day);
    for (const definition of ROUTES) {
      const route = data.routes.find((r) => r.name === definition.name);
      if (route === undefined) {
        throw new Error(`Route ${definition.name} fehlt`);
      }
      for (const departure of definition.departures) {
        const start = instantFromDamascusLocal(date, departure.time);
        const exists = await prisma.trip.findFirst({
          where: { routeId: route.id, departureAt: start },
          select: { id: true },
        });
        if (exists !== null) {
          tripsExisting++;
          continue;
        }
        const minutes = (offset: number | null): Date | null =>
          offset === null ? null : new Date(start.getTime() + offset * 60_000);
        const plan = planTrip({
          routeStops: route.stops,
          stopTimes: STOP_OFFSETS.map((o) => ({
            arrivalAt: minutes(o.arrival),
            departureAt: minutes(o.departure),
          })),
          seats: data.seats.map((s) => ({
            seatId: s.id,
            label: s.label,
            isSellable: s.isSellable,
          })),
          offlineSeatLabels: OFFLINE_SEATS,
          blockedSeatLabels: BLOCKED_SEATS,
          company: data.company,
        });
        // Jede Fahrt in einer eigenen Transaktion: entweder vollständig oder gar nicht.
        await prisma.$transaction((tx) =>
          insertTrip(tx, {
            companyId: data.companyId,
            routeId: route.id,
            seatLayoutId: data.layoutId,
            busId: data.busIdByPlate.get(departure.plate) ?? null,
            status: 'SCHEDULED',
            plan,
          }),
        );
        tripsCreated++;
      }
    }
  }
  return { companyId: data.companyId, tripsCreated, tripsExisting };
}
