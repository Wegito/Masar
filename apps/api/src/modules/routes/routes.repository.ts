import { Injectable } from '@nestjs/common';

import type { Prisma } from '../../generated/prisma/client.js';
import type { FareItem } from './domain/fare-matrix.js';
import type { ScheduledFare, StoredFare } from './domain/fare-schedule.js';

/**
 * Datenbankzugriff für Strecken, Haltestellen, Tarife und Stornoregeln. Jede Abfrage auf
 * firmeneigene Daten nennt die Firma, damit kein Pfad sie vergisst.
 */
type Db = Prisma.TransactionClient;

/** `date`-Spalte als Kalendertag `YYYY-MM-DD` (Prisma liefert Mitternacht UTC). */
export function toCalendarDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function fromCalendarDay(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

// --- Haltestellen ------------------------------------------------------------------------------

export interface StationRow {
  id: string;
  nameAr: string;
  nameEn: string;
  ownerCompanyId: string | null;
}

export interface CityCatalogRow {
  id: string;
  slug: string;
  nameAr: string;
  nameEn: string;
  stations: StationRow[];
}

const STATION_SELECT = {
  id: true,
  nameAr: true,
  nameEn: true,
  ownerCompanyId: true,
} as const satisfies Prisma.StationSelect;

/** Öffentliche Haltestellen (ohne Besitzerfirma) und die eigenen der Firma. */
function visibleTo(companyId: string): Prisma.StationWhereInput {
  return { OR: [{ ownerCompanyId: null }, { ownerCompanyId: companyId }] };
}

// --- Stornoregeln ------------------------------------------------------------------------------

export interface PolicyRow {
  id: string;
  name: string;
  allowPassengerCancel: boolean;
  createdAt: Date;
  rules: { minMinutesBeforeDeparture: number; feeBps: number }[];
  routeCount: number;
}

const POLICY_SELECT = {
  id: true,
  name: true,
  allowPassengerCancel: true,
  createdAt: true,
  rules: {
    select: { minMinutesBeforeDeparture: true, feeBps: true },
    orderBy: { minMinutesBeforeDeparture: 'desc' },
  },
  _count: { select: { routes: true } },
} as const satisfies Prisma.CancellationPolicySelect;

type PolicySelected = Prisma.CancellationPolicyGetPayload<{ select: typeof POLICY_SELECT }>;

function toPolicy(row: PolicySelected): PolicyRow {
  const { _count, ...rest } = row;
  return { ...rest, routeCount: _count.routes };
}

// --- Strecken ----------------------------------------------------------------------------------

export interface RouteStopRow {
  id: string;
  seq: number;
  station: {
    id: string;
    nameAr: string;
    nameEn: string;
    city: { id: string; nameAr: string; nameEn: string };
  };
}

export interface RouteSummaryRow {
  id: string;
  nameAr: string;
  nameEn: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  cancellationPolicy: { id: string; name: string };
  stops: RouteStopRow[];
  tripCount: number;
}

export interface RouteDetailRow extends RouteSummaryRow {
  fares: StoredFare[];
}

export interface LockedRoute {
  id: string;
  isActive: boolean;
  cancellationPolicyId: string;
}

const ROUTE_SUMMARY_SELECT = {
  id: true,
  nameAr: true,
  nameEn: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  cancellationPolicy: { select: { id: true, name: true } },
  stops: {
    select: {
      id: true,
      seq: true,
      station: {
        select: {
          id: true,
          nameAr: true,
          nameEn: true,
          city: { select: { id: true, nameAr: true, nameEn: true } },
        },
      },
    },
    orderBy: { seq: 'asc' },
  },
  _count: { select: { trips: true } },
} as const satisfies Prisma.RouteSelect;

type RouteSummarySelected = Prisma.RouteGetPayload<{ select: typeof ROUTE_SUMMARY_SELECT }>;

function toRouteSummary(row: RouteSummarySelected): RouteSummaryRow {
  const { _count, ...rest } = row;
  return { ...rest, tripCount: _count.trips };
}

@Injectable()
export class RoutesRepository {
  // --- Haltestellen ----------------------------------------------------------------------------

  /** Alle Städte (plattformweit) mit den für die Firma sichtbaren Haltestellen. */
  async stationCatalog(db: Db, companyId: string): Promise<CityCatalogRow[]> {
    return db.city.findMany({
      select: {
        id: true,
        slug: true,
        nameAr: true,
        nameEn: true,
        stations: {
          where: visibleTo(companyId),
          select: STATION_SELECT,
          orderBy: { nameEn: 'asc' },
        },
      },
      orderBy: { nameEn: 'asc' },
    });
  }

  async cityExists(db: Db, cityId: string): Promise<boolean> {
    return (await db.city.findUnique({ where: { id: cityId }, select: { id: true } })) !== null;
  }

  async insertStation(
    db: Db,
    data: { cityId: string; ownerCompanyId: string; nameAr: string; nameEn: string },
  ): Promise<StationRow & { cityId: string }> {
    return db.station.create({ data, select: { ...STATION_SELECT, cityId: true } });
  }

  /** Anzahl der genannten Haltestellen, die die Firma nutzen darf. */
  async countVisibleStations(db: Db, companyId: string, stationIds: string[]): Promise<number> {
    return db.station.count({ where: { id: { in: stationIds }, ...visibleTo(companyId) } });
  }

  // --- Stornoregeln ----------------------------------------------------------------------------

  async listPolicies(db: Db, companyId: string): Promise<PolicyRow[]> {
    const rows = await db.cancellationPolicy.findMany({
      where: { companyId },
      select: POLICY_SELECT,
      orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toPolicy);
  }

  async findPolicy(db: Db, companyId: string, policyId: string): Promise<PolicyRow | null> {
    const row = await db.cancellationPolicy.findFirst({
      where: { id: policyId, companyId },
      select: POLICY_SELECT,
    });
    return row === null ? null : toPolicy(row);
  }

  async policyExists(db: Db, companyId: string, policyId: string): Promise<boolean> {
    const row = await db.cancellationPolicy.findFirst({
      where: { id: policyId, companyId },
      select: { id: true },
    });
    return row !== null;
  }

  async insertPolicy(
    db: Db,
    data: {
      companyId: string;
      name: string;
      allowPassengerCancel: boolean;
      rules: { minMinutesBeforeDeparture: number; feeBps: number }[];
    },
  ): Promise<string> {
    const { rules, ...policy } = data;
    const row = await db.cancellationPolicy.create({
      data: { ...policy, rules: { create: rules } },
      select: { id: true },
    });
    return row.id;
  }

  // --- Strecken --------------------------------------------------------------------------------

  async listRoutes(
    db: Db,
    companyId: string,
    isActive: boolean | undefined,
  ): Promise<RouteSummaryRow[]> {
    const rows = await db.route.findMany({
      where: { companyId, ...(isActive === undefined ? {} : { isActive }) },
      select: ROUTE_SUMMARY_SELECT,
      orderBy: [{ isActive: 'desc' }, { nameEn: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toRouteSummary);
  }

  async findRoute(db: Db, companyId: string, routeId: string): Promise<RouteDetailRow | null> {
    const row = await db.route.findFirst({
      where: { id: routeId, companyId },
      select: {
        ...ROUTE_SUMMARY_SELECT,
        fares: {
          select: {
            amountMinor: true,
            currency: true,
            validFrom: true,
            validUntil: true,
            fromRouteStop: { select: { seq: true } },
            toRouteStop: { select: { seq: true } },
          },
        },
      },
    });
    if (row === null) return null;
    const { fares, ...summary } = row;
    return {
      ...toRouteSummary(summary),
      fares: fares.map((fare) => ({
        fromSeq: fare.fromRouteStop.seq,
        toSeq: fare.toRouteStop.seq,
        amountMinor: fare.amountMinor,
        currency: fare.currency,
        validFrom: toCalendarDay(fare.validFrom),
        validUntil: fare.validUntil === null ? null : toCalendarDay(fare.validUntil),
      })),
    };
  }

  /**
   * Sperrt die Strecken-Zeile (`FOR UPDATE`). Eine gleichzeitig angelegte Fahrt hält über ihren
   * Fremdschlüssel `trip (route_id, company_id) → route` `FOR KEY SHARE` auf derselben Zeile; die
   * Sperre wartet auf sie, und die Prüfung „von einer Fahrt genutzt" sieht sie danach.
   */
  async lockRoute(db: Db, companyId: string, routeId: string): Promise<LockedRoute | null> {
    const rows = await db.$queryRaw<LockedRoute[]>`
      SELECT id, is_active AS "isActive", cancellation_policy_id AS "cancellationPolicyId"
      FROM route
      WHERE id = ${routeId}::uuid AND company_id = ${companyId}::uuid
      FOR UPDATE`;
    return rows[0] ?? null;
  }

  async countTripsForRoute(db: Db, routeId: string): Promise<number> {
    return db.trip.count({ where: { routeId } });
  }

  async insertRoute(
    db: Db,
    data: { companyId: string; cancellationPolicyId: string; nameAr: string; nameEn: string },
  ): Promise<string> {
    const row = await db.route.create({ data, select: { id: true } });
    return row.id;
  }

  /** Legt die Halte in Reihenfolge an und liefert ihre IDs nach `seq`. */
  async insertStops(db: Db, routeId: string, stationIds: string[]): Promise<string[]> {
    const rows = await db.routeStop.createManyAndReturn({
      data: stationIds.map((stationId, seq) => ({ routeId, stationId, seq })),
      select: { id: true, seq: true },
    });
    return rows.sort((a, b) => a.seq - b.seq).map((row) => row.id);
  }

  /** IDs der Halte nach `seq`. */
  async stopIds(db: Db, routeId: string): Promise<string[]> {
    const rows = await db.routeStop.findMany({
      where: { routeId },
      select: { id: true },
      orderBy: { seq: 'asc' },
    });
    return rows.map((row) => row.id);
  }

  /**
   * Entfernt alle Tarife und Halte einer (gesperrten, unbenutzten) Strecke. Tarife zuerst: Sie
   * verweisen mit ON DELETE RESTRICT auf die Halte. Ein von einer Fahrt kopierter Halt würde das
   * Löschen über `trip_stop → route_stop` ebenfalls verhindern.
   */
  async deleteStopsAndFares(db: Db, routeId: string): Promise<void> {
    await db.fare.deleteMany({ where: { routeId } });
    await db.routeStop.deleteMany({ where: { routeId } });
  }

  async fareSchedule(db: Db, routeId: string): Promise<ScheduledFare[]> {
    const rows = await db.fare.findMany({
      where: { routeId },
      select: { id: true, validFrom: true, validUntil: true },
    });
    return rows.map((row) => ({
      id: row.id,
      validFrom: toCalendarDay(row.validFrom),
      validUntil: row.validUntil === null ? null : toCalendarDay(row.validUntil),
    }));
  }

  async deleteFares(db: Db, routeId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await db.fare.deleteMany({ where: { routeId, id: { in: ids } } });
  }

  async closeFares(db: Db, routeId: string, ids: string[], validUntil: string): Promise<void> {
    if (ids.length === 0) return;
    await db.fare.updateMany({
      where: { routeId, id: { in: ids } },
      data: { validUntil: fromCalendarDay(validUntil) },
    });
  }

  async insertFares(
    db: Db,
    routeId: string,
    stopIdsBySeq: string[],
    fares: { currency: string; validFrom: string; items: FareItem[] },
  ): Promise<void> {
    await db.fare.createMany({
      data: fares.items.map((item) => ({
        routeId,
        fromRouteStopId: stopIdsBySeq[item.fromSeq] ?? '',
        toRouteStopId: stopIdsBySeq[item.toSeq] ?? '',
        amountMinor: item.amountMinor,
        currency: fares.currency,
        validFrom: fromCalendarDay(fares.validFrom),
      })),
    });
  }

  async updateRoute(
    db: Db,
    routeId: string,
    data: { nameAr?: string; nameEn?: string; cancellationPolicyId?: string; isActive?: boolean },
  ): Promise<void> {
    await db.route.update({ where: { id: routeId }, data });
  }
}
