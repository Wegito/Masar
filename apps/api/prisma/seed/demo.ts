import { localDateInDamascus, SYRIA_TIME_ZONE } from '@masar/shared';

import type { Prisma, PrismaClient, SeatLayoutPattern } from '../../src/generated/prisma/client.js';
import { generateSeatLayout } from '../../src/modules/fleet/domain/seat-layout-generator.js';

/**
 * Demo-Daten für die lokale Entwicklung (Roadmap 1.1): eine erfundene Firma mit einer Route
 * Damaskus → Homs → Hama → Aleppo, einem 45-Sitzer und Fahrten für die nächsten sieben Tage.
 *
 * - Alles ist erfunden. Es gibt keine Personendaten, keine Buchungen und keine Passwörter.
 * - Idempotent: Jeder Datensatz wird über einen fachlichen Schlüssel gefunden oder angelegt.
 *   Ein zweiter Lauf ändert nichts; ein Lauf am Folgetag ergänzt nur die neuen Tage.
 * - Zeiten entstehen als Ortszeit in Asia/Damascus und werden in UTC gespeichert (ADR 0012).
 */

export const DEMO_COMPANY_SLUG = 'demo-pullman';
export const DEMO_DAYS = 7;
/** Abfahrten am Starthalt in Ortszeit. 23:00 erreicht Homs nach Mitternacht (Suche, ADR 0012). */
export const DEMO_DEPARTURES = ['07:00', '15:00', '23:00'] as const;

const CURRENCY = 'SYP';
/** Minuten bis zum nächsten Halt und Standzeit an Zwischenhalten. */
const LEG_MINUTES = [120, 60, 120] as const;
const DWELL_MINUTES = 10;

const CITIES = [
  { slug: 'damascus', nameAr: 'دمشق', nameEn: 'Damascus' },
  { slug: 'homs', nameAr: 'حمص', nameEn: 'Homs' },
  { slug: 'hama', nameAr: 'حماة', nameEn: 'Hama' },
  { slug: 'aleppo', nameAr: 'حلب', nameEn: 'Aleppo' },
] as const;

/**
 * Tarife je Haltestellenpaar in ganzen Pfund (nach der Redenominierung 2026, ADR 0011). Schlüssel:
 * Positionen von Einstieg und Ausstieg. Vier Halte ergeben sechs Paare.
 */
const FARES_SYP: Record<`${number}-${number}`, number> = {
  '0-1': 250,
  '0-2': 350,
  '0-3': 600,
  '1-2': 150,
  '1-3': 400,
  '2-3': 300,
};

/** Kontingent (ADR 0007): Reihen 9 und 10 verkauft der Schalter, Sitz 9A ist gesperrt. */
const COUNTER_ROWS = new Set([8, 9]);
const BLOCKED_LABELS = new Set(['9A']);

const LAYOUT_PATTERN: Record<'2+2' | '2+1', SeatLayoutPattern> = {
  '2+2': 'TWO_PLUS_TWO',
  '2+1': 'TWO_PLUS_ONE',
};

export interface DemoSeedOptions {
  /** Bezugszeitpunkt; der erste Fahrtag ist sein Kalendertag in Damaskus. */
  now?: Date;
}

export interface DemoSeedResult {
  companyId: string;
  routeId: string;
  seatLayoutId: string;
  tripIds: string[];
  createdTrips: number;
}

type Tx = Prisma.TransactionClient;

/** Versatz der Zone gegenüber UTC in Millisekunden zu einem Zeitpunkt. */
function zoneOffsetMs(instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SYRIA_TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour'),
    value('minute'),
    value('second'),
  );
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** Ortszeit in Damaskus (`YYYY-MM-DD`, `HH:MM`) als UTC-Zeitpunkt, ohne festen Offset. */
export function damascusLocalToUtc(date: string, time: string): Date {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  // Zweimal angleichen, damit auch ein Zonenwechsel zwischen Schätzung und Ergebnis stimmt.
  let result = naive - zoneOffsetMs(new Date(naive));
  result = naive - zoneOffsetMs(new Date(result));
  return new Date(result);
}

/** Kalendertag `YYYY-MM-DD` plus n Tage (reine Datumsrechnung, ohne Zone). */
function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** Kalendertag als Wert für eine `date`-Spalte (Prisma erwartet Mitternacht UTC). */
function dateColumn(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function addMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * 60_000);
}

async function seedCompany(tx: Tx): Promise<{ id: string; genderRuleEnabled: boolean }> {
  return tx.company.upsert({
    where: { slug: DEMO_COMPANY_SLUG },
    update: {},
    create: {
      slug: DEMO_COMPANY_SLUG,
      // Erfundener Name; "تجريبي" bzw. "Demo" macht die Firma in jeder Oberfläche erkennbar.
      nameAr: 'بولمان مسار التجريبي',
      nameEn: 'Masar Demo Pullman',
      genderRuleEnabled: true,
      requireNationalId: false,
      defaultCurrency: CURRENCY,
    },
    select: { id: true, genderRuleEnabled: true },
  });
}

async function seedStations(tx: Tx): Promise<string[]> {
  const stationIds: string[] = [];
  for (const city of CITIES) {
    const { id: cityId } = await tx.city.upsert({
      where: { slug: city.slug },
      update: {},
      create: city,
      select: { id: true },
    });
    // Erfundene Haltestelle ohne Koordinaten, damit sie nicht für einen echten Busbahnhof gehalten wird.
    const station = {
      cityId,
      nameAr: `${city.nameAr} – محطة تجريبية`,
      nameEn: `${city.nameEn} Demo Terminal`,
    };
    const existing = await tx.station.findFirst({
      where: { cityId, nameEn: station.nameEn },
      select: { id: true },
    });
    stationIds.push(existing?.id ?? (await tx.station.create({ data: station })).id);
  }
  return stationIds;
}

async function seedPolicy(tx: Tx, companyId: string): Promise<string> {
  const name = 'Demo-Standard';
  const policy =
    (await tx.cancellationPolicy.findFirst({
      where: { companyId, name },
      select: { id: true },
    })) ??
    (await tx.cancellationPolicy.create({
      data: { companyId, name, allowPassengerCancel: true },
      select: { id: true },
    }));
  // Ab 24 Stunden vor Abfahrt kostenlos, ab 2 Stunden 25 %, darunter 50 %.
  const rules = [
    { minMinutesBeforeDeparture: 1440, feeBps: 0 },
    { minMinutesBeforeDeparture: 120, feeBps: 2500 },
    { minMinutesBeforeDeparture: 0, feeBps: 5000 },
  ];
  for (const rule of rules) {
    await tx.cancellationPolicyRule.upsert({
      where: {
        policyId_minMinutesBeforeDeparture: {
          policyId: policy.id,
          minMinutesBeforeDeparture: rule.minMinutesBeforeDeparture,
        },
      },
      update: {},
      create: { policyId: policy.id, ...rule },
    });
  }
  return policy.id;
}

async function seedRoute(
  tx: Tx,
  companyId: string,
  policyId: string,
  stationIds: string[],
  firstDay: string,
): Promise<{ routeId: string; routeStopIds: string[] }> {
  const nameEn = 'Damascus – Homs – Hama – Aleppo';
  const route =
    (await tx.route.findFirst({ where: { companyId, nameEn }, select: { id: true } })) ??
    (await tx.route.create({
      data: {
        companyId,
        cancellationPolicyId: policyId,
        nameAr: 'دمشق – حمص – حماة – حلب',
        nameEn,
      },
      select: { id: true },
    }));

  const routeStopIds: string[] = [];
  for (const [seq, stationId] of stationIds.entries()) {
    const stop = await tx.routeStop.upsert({
      where: { routeId_seq: { routeId: route.id, seq } },
      update: {},
      create: { routeId: route.id, stationId, seq },
      select: { id: true },
    });
    routeStopIds.push(stop.id);
  }

  for (const [pair, amountSyp] of Object.entries(FARES_SYP)) {
    const [from, to] = pair.split('-').map(Number) as [number, number];
    const fromRouteStopId = routeStopIds[from]!;
    const toRouteStopId = routeStopIds[to]!;
    // Ein unbefristeter Tarif je Paar; das EXCLUDE-Constraint verbietet einen zweiten.
    const existing = await tx.fare.findFirst({
      where: { fromRouteStopId, toRouteStopId },
      select: { id: true },
    });
    if (existing === null) {
      await tx.fare.create({
        data: {
          routeId: route.id,
          fromRouteStopId,
          toRouteStopId,
          amountMinor: amountSyp * 100,
          currency: CURRENCY,
          validFrom: dateColumn(firstDay),
        },
      });
    }
  }
  return { routeId: route.id, routeStopIds };
}

async function seedFleet(
  tx: Tx,
  companyId: string,
): Promise<{
  seatLayoutId: string;
  busId: string;
  seats: { id: string; label: string; rowIndex: number }[];
}> {
  const spec = { pattern: '2+2', rows: 10, backBench: 5 } as const;
  const generated = generateSeatLayout(spec);
  const layout = await tx.seatLayout.upsert({
    where: { companyId_name_version: { companyId, name: 'Standard 45', version: 1 } },
    update: {},
    create: {
      companyId,
      name: 'Standard 45',
      version: 1,
      pattern: LAYOUT_PATTERN[spec.pattern],
      status: 'ACTIVE',
    },
    select: { id: true },
  });

  await tx.seat.createMany({
    data: generated.seats.map((seat) => ({ layoutId: layout.id, ...seat })),
    skipDuplicates: true,
  });
  const seats = await tx.seat.findMany({
    where: { layoutId: layout.id },
    select: { id: true, label: true, rowIndex: true },
    orderBy: [{ rowIndex: 'asc' }, { colIndex: 'asc' }],
  });
  const idByLabel = new Map(seats.map((seat) => [seat.label, seat.id]));
  const seatId = (label: string): string => {
    const id = idByLabel.get(label);
    if (id === undefined) {
      throw new Error(`Sitz ${label} fehlt im Sitzplan`);
    }
    return id;
  };
  // Jedes Paar in beiden Richtungen (domaenenmodell.md, Sitzpläne).
  await tx.seatNeighbor.createMany({
    data: generated.neighbors.flatMap(([a, b]) => [
      { layoutId: layout.id, seatId: seatId(a), neighborSeatId: seatId(b) },
      { layoutId: layout.id, seatId: seatId(b), neighborSeatId: seatId(a) },
    ]),
    skipDuplicates: true,
  });

  const bus = await tx.bus.upsert({
    where: { companyId_plate: { companyId, plate: 'DEMO-001' } },
    update: {},
    create: { companyId, plate: 'DEMO-001', seatLayoutId: layout.id },
    select: { id: true },
  });
  return { seatLayoutId: layout.id, busId: bus.id, seats };
}

async function seedCommissionRate(tx: Tx, companyId: string, firstDay: string): Promise<void> {
  const existing = await tx.commissionRate.findFirst({
    where: { companyId },
    select: { id: true },
  });
  if (existing === null) {
    // 3 % unbefristet; die Höhe ist ein Platzhalter (ADR 0017).
    await tx.commissionRate.create({
      data: { companyId, rateBps: 300, validFrom: dateColumn(firstDay) },
    });
  }
}

export async function seedDemo(
  prisma: PrismaClient,
  options: DemoSeedOptions = {},
): Promise<DemoSeedResult> {
  const now = options.now ?? new Date();
  const firstDay = localDateInDamascus(now);

  return prisma.$transaction(
    async (tx) => {
      const company = await seedCompany(tx);
      const stationIds = await seedStations(tx);
      const policyId = await seedPolicy(tx, company.id);
      const { routeId, routeStopIds } = await seedRoute(
        tx,
        company.id,
        policyId,
        stationIds,
        firstDay,
      );
      const { seatLayoutId, busId, seats } = await seedFleet(tx, company.id);
      await seedCommissionRate(tx, company.id, firstDay);

      const tripIds: string[] = [];
      let createdTrips = 0;
      for (let dayOffset = 0; dayOffset < DEMO_DAYS; dayOffset++) {
        const serviceDay = addDays(firstDay, dayOffset);
        for (const time of DEMO_DEPARTURES) {
          const departureAt = damascusLocalToUtc(serviceDay, time);
          const existing = await tx.trip.findFirst({
            where: { companyId: company.id, routeId, departureAt },
            select: { id: true },
          });
          if (existing !== null) {
            tripIds.push(existing.id);
            continue;
          }

          // Halte: Abfahrt am Start, dann je Abschnitt Fahrzeit plus Standzeit.
          const stops: { seq: number; arrivalAt: Date | null; departureAt: Date | null }[] = [];
          let clock = departureAt;
          for (let seq = 0; seq < routeStopIds.length; seq++) {
            const isFirst = seq === 0;
            const isLast = seq === routeStopIds.length - 1;
            const arrivalAt = isFirst ? null : clock;
            const leaveAt = isLast ? null : isFirst ? clock : addMinutes(clock, DWELL_MINUTES);
            stops.push({ seq, arrivalAt, departureAt: leaveAt });
            if (leaveAt !== null) {
              clock = addMinutes(leaveAt, LEG_MINUTES[seq]!);
            }
          }
          const arrivalAt = stops.at(-1)!.arrivalAt!;

          const trip = await tx.trip.create({
            data: {
              companyId: company.id,
              routeId,
              seatLayoutId,
              busId,
              serviceDate: dateColumn(serviceDay),
              departureAt,
              arrivalAt,
              status: 'SCHEDULED',
              onlineSalesCloseAt: addMinutes(departureAt, -30),
              cashDeadlineAt: addMinutes(departureAt, -120),
              genderRuleEnabled: company.genderRuleEnabled,
            },
            select: { id: true },
          });
          await tx.tripStop.createMany({
            data: stops.map((stop) => ({
              tripId: trip.id,
              routeStopId: routeStopIds[stop.seq]!,
              stationId: stationIds[stop.seq]!,
              seq: stop.seq,
              arrivalAt: stop.arrivalAt,
              departureAt: stop.departureAt,
            })),
          });
          // Kontingent ausdrücklich je Sitz, solange das Portal es nicht pflegt (ADR 0007).
          await tx.tripSeat.createMany({
            data: seats.map((seat) => ({
              tripId: trip.id,
              seatId: seat.id,
              seatLayoutId,
              onlineSellable: !COUNTER_ROWS.has(seat.rowIndex),
              blocked: BLOCKED_LABELS.has(seat.label),
            })),
          });
          tripIds.push(trip.id);
          createdTrips++;
        }
      }
      return { companyId: company.id, routeId, seatLayoutId, tripIds, createdTrips };
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}
