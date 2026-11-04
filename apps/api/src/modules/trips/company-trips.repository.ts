import { Injectable } from '@nestjs/common';

import {
  type BusStatus,
  Prisma,
  type SeatLayoutStatus,
  type SeatSide,
  type TripStatus,
} from '../../generated/prisma/client.js';
import type { TripListCursor } from './domain/trip-list-cursor.js';
import type {
  ExistingTrip,
  FareValidity,
  LayoutSeat,
  StopTime,
  TimeSpan,
  TripSeatState,
} from './domain/trip-planning.js';

/**
 * Datenbankzugriff der Fahrtplanung (Schritt 2.4). Jede Abfrage auf firmeneigene Daten nennt die
 * Firma. Sperren: Strecke `FOR UPDATE` (serialisiert Veröffentlichungen derselben Strecke), Bus
 * `FOR UPDATE` (serialisiert die Belegung eines Busses über Strecken hinweg), Sitzplan
 * `FOR SHARE` (ein gleichzeitiges Archivieren wartet). Reihenfolge immer Strecke → Bus → Sitzplan.
 */
type Db = Prisma.TransactionClient;

/** `date`-Spalte aus einem Kalendertag `YYYY-MM-DD` (Prisma speichert Mitternacht UTC). */
function dateColumn(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

export interface PlanningRoute {
  id: string;
  isActive: boolean;
}

export interface PlanningRouteStop {
  id: string;
  stationId: string;
  seq: number;
}

export interface PlanningBus {
  id: string;
  status: BusStatus;
  seatLayoutId: string;
}

export interface PlanningLayout {
  id: string;
  status: SeatLayoutStatus;
}

export interface CompanyTripSettings {
  genderRuleEnabled: boolean;
  onlineSalesCloseMinutes: number;
}

export interface NewTrip {
  companyId: string;
  routeId: string;
  seatLayoutId: string;
  busId: string | null;
  serviceDate: string;
  departureAt: Date;
  arrivalAt: Date;
  onlineSalesCloseAt: Date;
  genderRuleEnabled: boolean;
  stops: StopTime[];
}

export interface TripSummaryRow {
  id: string;
  status: TripStatus;
  serviceDate: string;
  departureAt: Date;
  arrivalAt: Date;
  onlineSalesCloseAt: Date;
  genderRuleEnabled: boolean;
  routeId: string;
  routeNameAr: string;
  routeNameEn: string;
  busId: string | null;
  busPlate: string | null;
  seatLayoutId: string;
  seatLayoutName: string;
  seatLayoutVersion: number;
  seatTotal: number;
  seatOnline: number;
  seatCounter: number;
  seatBlocked: number;
  seatOccupied: number;
  activeBookings: number;
}

export interface TripStopRow {
  id: string;
  seq: number;
  arrivalAt: Date | null;
  departureAt: Date | null;
  station: { id: string; nameAr: string; nameEn: string };
  city: { id: string; nameAr: string; nameEn: string };
}

export interface TripSeatRow {
  seatId: string;
  label: string;
  row: number;
  column: number;
  side: SeatSide;
  isSellable: boolean;
  onlineSellable: boolean;
  blocked: boolean;
  occupied: boolean;
}

export interface TripListFilter {
  start: Date;
  end: Date;
  routeId?: string;
  status?: TripStatus;
  cursor?: TripListCursor;
  limit: number;
}

/** Zusammenfassung einer Fahrt mit Zählern; Bedingung und Reihenfolge setzt der Aufrufer. */
function summarySql(where: Prisma.Sql, tail: Prisma.Sql = Prisma.empty): Prisma.Sql {
  return Prisma.sql`
    SELECT t.id, t.status, t.service_date::text AS "serviceDate", t.departure_at AS "departureAt",
           t.arrival_at AS "arrivalAt", t.online_sales_close_at AS "onlineSalesCloseAt",
           t.gender_rule_enabled AS "genderRuleEnabled",
           r.id AS "routeId", r.name_ar AS "routeNameAr", r.name_en AS "routeNameEn",
           b.id AS "busId", b.plate AS "busPlate",
           l.id AS "seatLayoutId", l.name AS "seatLayoutName", l.version AS "seatLayoutVersion",
           seats.total AS "seatTotal", seats.online AS "seatOnline", seats.counter AS "seatCounter",
           seats.blocked AS "seatBlocked",
           (SELECT count(DISTINCT so.seat_id)::int FROM seat_occupation so
            WHERE so.trip_id = t.id) AS "seatOccupied",
           (SELECT count(*)::int FROM booking bk
            WHERE bk.trip_id = t.id
              AND bk.status IN ('HELD', 'RESERVED', 'PENDING_CONFIRMATION', 'CONFIRMED'))
             AS "activeBookings"
    FROM trip t
    JOIN route r ON r.id = t.route_id
    JOIN seat_layout l ON l.id = t.seat_layout_id
    LEFT JOIN bus b ON b.id = t.bus_id
    CROSS JOIN LATERAL (
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE ts.online_sellable AND NOT ts.blocked)::int AS online,
             count(*) FILTER (WHERE NOT ts.online_sellable AND NOT ts.blocked)::int AS counter,
             count(*) FILTER (WHERE ts.blocked)::int AS blocked
      FROM trip_seat ts WHERE ts.trip_id = t.id
    ) seats
    WHERE ${where}
    ${tail}`;
}

@Injectable()
export class CompanyTripsRepository {
  // --- Planung ---------------------------------------------------------------------------------

  async route(
    db: Db,
    companyId: string,
    routeId: string,
    lock: boolean,
  ): Promise<PlanningRoute | null> {
    const rows = await db.$queryRaw<PlanningRoute[]>`
      SELECT id, is_active AS "isActive"
      FROM route
      WHERE id = ${routeId}::uuid AND company_id = ${companyId}::uuid
      ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`;
    return rows[0] ?? null;
  }

  async routeStops(db: Db, routeId: string): Promise<PlanningRouteStop[]> {
    return db.routeStop.findMany({
      where: { routeId },
      select: { id: true, stationId: true, seq: true },
      orderBy: { seq: 'asc' },
    });
  }

  /** Alle Tarife der Strecke mit Positionen statt Halt-IDs. */
  async routeFares(db: Db, routeId: string): Promise<FareValidity[]> {
    return db.$queryRaw<FareValidity[]>`
      SELECT fs.seq AS "fromSeq", ts.seq AS "toSeq", f.valid_from::text AS "validFrom",
             f.valid_until::text AS "validUntil"
      FROM fare f
      JOIN route_stop fs ON fs.id = f.from_route_stop_id
      JOIN route_stop ts ON ts.id = f.to_route_stop_id
      WHERE f.route_id = ${routeId}::uuid`;
  }

  async bus(db: Db, companyId: string, busId: string, lock: boolean): Promise<PlanningBus | null> {
    const rows = await db.$queryRaw<PlanningBus[]>`
      SELECT id, status, seat_layout_id AS "seatLayoutId"
      FROM bus
      WHERE id = ${busId}::uuid AND company_id = ${companyId}::uuid
      ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`;
    return rows[0] ?? null;
  }

  async layout(
    db: Db,
    companyId: string,
    layoutId: string,
    lock: boolean,
  ): Promise<PlanningLayout | null> {
    const rows = await db.$queryRaw<PlanningLayout[]>`
      SELECT id, status
      FROM seat_layout
      WHERE id = ${layoutId}::uuid AND company_id = ${companyId}::uuid
      ${lock ? Prisma.sql`FOR SHARE` : Prisma.empty}`;
    return rows[0] ?? null;
  }

  async layoutSeats(db: Db, layoutId: string): Promise<LayoutSeat[]> {
    return db.seat.findMany({
      where: { layoutId },
      select: { id: true, rowIndex: true, colIndex: true, isSellable: true },
    });
  }

  async companySettings(db: Db, companyId: string): Promise<CompanyTripSettings> {
    return db.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { genderRuleEnabled: true, onlineSalesCloseMinutes: true },
    });
  }

  /**
   * Fahrten derselben Strecke zu denselben Abfahrten mit demselben Bus (mit Bus) bzw. ohne Bus mit
   * demselben Sitzplan, in jedem Status. Das ist die Eindeutigkeit, über die eine zweite
   * Veröffentlichung nichts doppelt anlegt.
   */
  async sameSlotTrips(
    db: Db,
    input: { routeId: string; busId: string | null; seatLayoutId: string; departures: Date[] },
  ): Promise<ExistingTrip[]> {
    if (input.departures.length === 0) return [];
    return db.trip.findMany({
      where: {
        routeId: input.routeId,
        departureAt: { in: input.departures },
        ...(input.busId === null
          ? { busId: null, seatLayoutId: input.seatLayoutId }
          : { busId: input.busId }),
      },
      select: { id: true, departureAt: true },
    });
  }

  /** Zeiträume, in denen der Bus mit einer nicht gestrichenen Fahrt unterwegs ist. */
  async busBusy(db: Db, busId: string, window: TimeSpan): Promise<TimeSpan[]> {
    const rows = await db.trip.findMany({
      where: {
        busId,
        status: { not: 'CANCELLED' },
        departureAt: { lt: window.end },
        arrivalAt: { gt: window.start },
      },
      select: { departureAt: true, arrivalAt: true },
    });
    return rows.map((row) => ({ start: row.departureAt, end: row.arrivalAt }));
  }

  /**
   * Legt Fahrten (`SCHEDULED`) mit Halten und Kontingent an. Die Halte sind eine Kopie der Strecke
   * (Domänenmodell); das Kontingent setzt jede Fahrt ausdrücklich je Sitz (ADR 0007).
   */
  async insertTrips(
    db: Db,
    trips: NewTrip[],
    routeStops: PlanningRouteStop[],
    quota: Map<string, boolean>,
  ): Promise<{ id: string; departureAt: Date }[]> {
    if (trips.length === 0) return [];
    const created = await db.trip.createManyAndReturn({
      data: trips.map((trip) => ({
        companyId: trip.companyId,
        routeId: trip.routeId,
        seatLayoutId: trip.seatLayoutId,
        busId: trip.busId,
        serviceDate: dateColumn(trip.serviceDate),
        departureAt: trip.departureAt,
        arrivalAt: trip.arrivalAt,
        status: 'SCHEDULED',
        onlineSalesCloseAt: trip.onlineSalesCloseAt,
        genderRuleEnabled: trip.genderRuleEnabled,
      })),
      select: { id: true, departureAt: true },
    });
    const idByDeparture = new Map(created.map((row) => [row.departureAt.getTime(), row.id]));
    const tripId = (trip: NewTrip): string => idByDeparture.get(trip.departureAt.getTime())!;
    await db.tripStop.createMany({
      data: trips.flatMap((trip) =>
        trip.stops.map((stop) => ({
          tripId: tripId(trip),
          routeStopId: routeStops[stop.seq]!.id,
          stationId: routeStops[stop.seq]!.stationId,
          seq: stop.seq,
          arrivalAt: stop.arrivalAt,
          departureAt: stop.departureAt,
        })),
      ),
    });
    await db.tripSeat.createMany({
      data: trips.flatMap((trip) =>
        [...quota].map(([seatId, onlineSellable]) => ({
          tripId: tripId(trip),
          seatId,
          seatLayoutId: trip.seatLayoutId,
          onlineSellable,
        })),
      ),
    });
    return created;
  }

  // --- Lesen -------------------------------------------------------------------------------------

  async listTrips(db: Db, companyId: string, filter: TripListFilter): Promise<TripSummaryRow[]> {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`t.company_id = ${companyId}::uuid`,
      Prisma.sql`t.departure_at >= ${filter.start}::timestamptz`,
      Prisma.sql`t.departure_at < ${filter.end}::timestamptz`,
    ];
    if (filter.routeId !== undefined) {
      conditions.push(Prisma.sql`t.route_id = ${filter.routeId}::uuid`);
    }
    if (filter.status !== undefined) {
      conditions.push(Prisma.sql`t.status = ${filter.status}::"TripStatus"`);
    }
    if (filter.cursor !== undefined) {
      conditions.push(
        Prisma.sql`(t.departure_at, t.id) > (${filter.cursor.departureAt}::timestamptz, ${filter.cursor.tripId}::uuid)`,
      );
    }
    return db.$queryRaw<TripSummaryRow[]>(
      summarySql(
        Prisma.join(conditions, ' AND '),
        Prisma.sql`ORDER BY t.departure_at, t.id LIMIT ${filter.limit}`,
      ),
    );
  }

  async tripSummary(db: Db, companyId: string, tripId: string): Promise<TripSummaryRow | null> {
    const rows = await db.$queryRaw<TripSummaryRow[]>(
      summarySql(Prisma.sql`t.id = ${tripId}::uuid AND t.company_id = ${companyId}::uuid`),
    );
    return rows[0] ?? null;
  }

  async tripSummaries(db: Db, companyId: string, tripIds: string[]): Promise<TripSummaryRow[]> {
    if (tripIds.length === 0) return [];
    return db.$queryRaw<TripSummaryRow[]>(
      summarySql(
        Prisma.sql`t.id IN (${Prisma.join(tripIds.map((id) => Prisma.sql`${id}::uuid`))})
                   AND t.company_id = ${companyId}::uuid`,
        Prisma.sql`ORDER BY t.departure_at, t.id`,
      ),
    );
  }

  async tripStops(db: Db, tripId: string): Promise<TripStopRow[]> {
    const rows = await db.tripStop.findMany({
      where: { tripId },
      select: {
        id: true,
        seq: true,
        arrivalAt: true,
        departureAt: true,
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
    });
    return rows.map(({ station: { city, ...station }, ...stop }) => ({ ...stop, station, city }));
  }

  async tripSeats(db: Db, tripId: string): Promise<TripSeatRow[]> {
    return db.$queryRaw<TripSeatRow[]>`
      SELECT s.id AS "seatId", s.label, s.row_index AS "row", s.col_index AS "column", s.side,
             s.is_sellable AS "isSellable", ts.online_sellable AS "onlineSellable", ts.blocked,
             EXISTS (SELECT 1 FROM seat_occupation so
                     WHERE so.trip_id = ts.trip_id AND so.seat_id = ts.seat_id) AS occupied
      FROM trip_seat ts
      JOIN seat s ON s.id = ts.seat_id
      WHERE ts.trip_id = ${tripId}::uuid
      ORDER BY s.row_index, s.col_index`;
  }

  // --- Ändern (nur unter der Trip-Sperre) -------------------------------------------------------

  async tripSeatStates(db: Db, tripId: string): Promise<TripSeatState[]> {
    const rows = await this.tripSeats(db, tripId);
    return rows.map((row) => ({
      seatId: row.seatId,
      label: row.label,
      onlineSellable: row.onlineSellable,
      occupied: row.occupied,
    }));
  }

  async setOnlineSellable(
    db: Db,
    tripId: string,
    seatIds: string[],
    onlineSellable: boolean,
    now: Date,
  ): Promise<number> {
    if (seatIds.length === 0) return 0;
    return db.$executeRaw`
      UPDATE trip_seat
      SET online_sellable = ${onlineSellable}, updated_at = ${now}::timestamptz
      WHERE trip_id = ${tripId}::uuid
        AND seat_id IN (${Prisma.join(seatIds.map((id) => Prisma.sql`${id}::uuid`))})`;
  }

  async markCancelled(db: Db, tripId: string, now: Date): Promise<void> {
    await db.$executeRaw`
      UPDATE trip SET status = 'CANCELLED', version = version + 1, updated_at = ${now}::timestamptz
      WHERE id = ${tripId}::uuid`;
  }
}
