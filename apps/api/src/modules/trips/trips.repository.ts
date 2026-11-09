import { Injectable } from '@nestjs/common';

import {
  type CompanyStatus,
  type Gender,
  Prisma,
  type SeatSide,
  type TripStatus,
} from '../../generated/prisma/client.js';
import { expiredCondition } from '../bookings/bookings.repository.js';
import type { SearchCursor } from './domain/search-cursor.js';

/** Lesender Datenbankzugriff für Suche und Sitzplan. Schreibt nie; Sitzbelegung schreibt nur der Buchungsservice. */
type Db = Prisma.TransactionClient;

export interface SearchParams {
  fromCityId: string;
  toCityId: string;
  /** Abfahrt am Einstiegshalt im halboffenen Intervall `[start, end)`. */
  start: Date;
  end: Date;
  now: Date;
  passengers: number;
  /** Höchstzahl der Zeilen; der Service fragt eine mehr ab, um eine Folgeseite zu erkennen. */
  limit: number;
  cursor?: SearchCursor;
}

export interface SearchRow {
  tripId: string;
  companyId: string;
  companyNameAr: string;
  companyNameEn: string;
  genderRuleEnabled: boolean;
  fromStopId: string;
  fromSeq: number;
  departureAt: Date;
  toStopId: string;
  toSeq: number;
  fareAmountMinor: number;
  fareCurrency: string;
  freeSeats: number;
}

export interface StopRow {
  id: string;
  tripId: string;
  seq: number;
  routeStopId: string;
  stationId: string;
  cityId: string;
  nameAr: string;
  nameEn: string;
  arrivalAt: Date | null;
  departureAt: Date | null;
}

export interface TripRow {
  id: string;
  status: TripStatus;
  routeId: string;
  seatLayoutId: string;
  serviceDate: Date;
  onlineSalesCloseAt: Date;
  genderRuleEnabled: boolean;
  company: {
    id: string;
    nameAr: string;
    nameEn: string;
    status: CompanyStatus;
    requireNationalId: boolean;
  };
  stops: StopRow[];
}

export interface SeatInventory {
  seats: {
    id: string;
    label: string;
    rowIndex: number;
    colIndex: number;
    side: SeatSide;
    isSellable: boolean;
  }[];
  tripSeats: { seatId: string; onlineSellable: boolean; blocked: boolean }[];
  neighbors: { seatId: string; neighborSeatId: string }[];
  /**
   * Nur Belegungen, die die Teilstrecke überlappen, ohne die abgelaufener, noch nicht freigegebener
   * Buchungen. Das Geschlecht verlässt den Service nie.
   */
  occupations: { seatId: string; fromSeq: number; toSeq: number; gender: Gender | null }[];
}

interface RawSearchRow extends Omit<SearchRow, 'freeSeats'> {
  freeSeats: bigint;
}

const STOP_SELECT = {
  id: true,
  tripId: true,
  seq: true,
  routeStopId: true,
  stationId: true,
  arrivalAt: true,
  departureAt: true,
  station: { select: { cityId: true, nameAr: true, nameEn: true } },
} as const;

function toStopRow(stop: {
  id: string;
  tripId: string;
  seq: number;
  routeStopId: string;
  stationId: string;
  arrivalAt: Date | null;
  departureAt: Date | null;
  station: { cityId: string; nameAr: string; nameEn: string };
}): StopRow {
  const { station, ...rest } = stop;
  return { ...rest, ...station };
}

@Injectable()
export class TripsRepository {
  /**
   * Fahrten mit Einstieg in der einen und späterem Ausstieg in der anderen Stadt. Eine Zeile je
   * Haltestellenpaar: Hat eine Stadt auf der Route zwei Haltestellen, erscheinen beide.
   *
   * - Filter über die Abfahrt am Einstiegshalt, nicht über `service_date` (ADR 0012).
   * - Nur `SCHEDULED`, offener Online-Verkauf und aktive Firma.
   * - Nur mit gültigem Tarif für das Paar am Fahrtag (`service_date`, halboffen).
   * - Freie Sitze zählen nur aus dem Online-Kontingent (ADR 0007), ohne Geschlechtsregel.
   * - Belegungen abgelaufener, noch nicht freigegebener Buchungen zählen nicht (wie am Schalter).
   */
  async search(db: Db, params: SearchParams): Promise<SearchRow[]> {
    const after =
      params.cursor === undefined
        ? Prisma.empty
        : Prisma.sql`AND (c.departure_at, c.trip_id, c.from_stop_id, c.to_stop_id) >
              (${params.cursor.departureAt}::timestamptz, ${params.cursor.tripId}::uuid,
               ${params.cursor.fromStopId}::uuid, ${params.cursor.toStopId}::uuid)`;
    const rows = await db.$queryRaw<RawSearchRow[]>`
      WITH candidate AS (
        SELECT t.id AS trip_id, t.company_id, t.route_id, t.service_date, t.gender_rule_enabled,
               co.name_ar AS company_name_ar, co.name_en AS company_name_en,
               b.id AS from_stop_id, b.seq AS from_seq, b.route_stop_id AS from_route_stop_id,
               b.departure_at,
               a.id AS to_stop_id, a.seq AS to_seq, a.route_stop_id AS to_route_stop_id
        FROM trip_stop b
        JOIN station bs ON bs.id = b.station_id
        JOIN trip t ON t.id = b.trip_id
        JOIN company co ON co.id = t.company_id
        JOIN trip_stop a ON a.trip_id = b.trip_id AND a.seq > b.seq
        JOIN station st ON st.id = a.station_id
        WHERE bs.city_id = ${params.fromCityId}::uuid
          AND st.city_id = ${params.toCityId}::uuid
          AND b.departure_at >= ${params.start}::timestamptz
          AND b.departure_at < ${params.end}::timestamptz
          AND t.status = 'SCHEDULED'
          AND t.online_sales_close_at > ${params.now}::timestamptz
          AND co.status = 'ACTIVE'
      ),
      priced AS (
        SELECT c.*, f.amount_minor AS fare_amount_minor, f.currency AS fare_currency,
               (SELECT count(*)
                FROM trip_seat ts
                JOIN seat s ON s.id = ts.seat_id
                WHERE ts.trip_id = c.trip_id
                  AND ts.online_sellable
                  AND NOT ts.blocked
                  AND s.is_sellable
                  AND NOT EXISTS (
                    SELECT 1 FROM seat_occupation so
                    JOIN booking b ON b.id = so.booking_id
                    WHERE NOT ${expiredCondition(params.now)}
                      AND so.trip_id = ts.trip_id
                      AND so.seat_id = ts.seat_id
                      AND int4range(so.from_seq, so.to_seq) && int4range(c.from_seq, c.to_seq)
                  )) AS free_seats
        FROM candidate c
        JOIN fare f
          ON f.route_id = c.route_id
         AND f.from_route_stop_id = c.from_route_stop_id
         AND f.to_route_stop_id = c.to_route_stop_id
         AND f.valid_from <= c.service_date
         AND (f.valid_until IS NULL OR c.service_date < f.valid_until)
      )
      SELECT c.trip_id AS "tripId", c.company_id AS "companyId",
             c.company_name_ar AS "companyNameAr", c.company_name_en AS "companyNameEn",
             c.gender_rule_enabled AS "genderRuleEnabled",
             c.from_stop_id AS "fromStopId", c.from_seq AS "fromSeq",
             c.departure_at AS "departureAt",
             c.to_stop_id AS "toStopId", c.to_seq AS "toSeq",
             c.fare_amount_minor AS "fareAmountMinor", c.fare_currency AS "fareCurrency",
             c.free_seats AS "freeSeats"
      FROM priced c
      WHERE c.free_seats >= ${params.passengers}
      ${after}
      ORDER BY c.departure_at, c.trip_id, c.from_stop_id, c.to_stop_id
      LIMIT ${params.limit}`;
    return rows.map((row) => ({ ...row, freeSeats: Number(row.freeSeats) }));
  }

  async findStops(db: Db, tripIds: readonly string[]): Promise<StopRow[]> {
    if (tripIds.length === 0) {
      return [];
    }
    const stops = await db.tripStop.findMany({
      where: { tripId: { in: [...tripIds] } },
      select: STOP_SELECT,
      orderBy: [{ tripId: 'asc' }, { seq: 'asc' }],
    });
    return stops.map(toStopRow);
  }

  async findTrip(db: Db, tripId: string): Promise<TripRow | null> {
    const trip = await db.trip.findUnique({
      where: { id: tripId },
      select: {
        id: true,
        status: true,
        routeId: true,
        seatLayoutId: true,
        serviceDate: true,
        onlineSalesCloseAt: true,
        genderRuleEnabled: true,
        company: {
          select: { id: true, nameAr: true, nameEn: true, status: true, requireNationalId: true },
        },
        stops: { select: STOP_SELECT, orderBy: { seq: 'asc' } },
      },
    });
    return trip === null ? null : { ...trip, stops: trip.stops.map(toStopRow) };
  }

  /** Gültiger Tarif für das Paar am Fahrtag; `fare_no_overlap` garantiert höchstens einen. */
  async findFare(
    db: Db,
    input: { routeId: string; fromRouteStopId: string; toRouteStopId: string; serviceDate: Date },
  ): Promise<{ amountMinor: number; currency: string } | null> {
    return db.fare.findFirst({
      where: {
        routeId: input.routeId,
        fromRouteStopId: input.fromRouteStopId,
        toRouteStopId: input.toRouteStopId,
        validFrom: { lte: input.serviceDate },
        OR: [{ validUntil: null }, { validUntil: { gt: input.serviceDate } }],
      },
      select: { amountMinor: true, currency: true },
    });
  }

  async findSeatInventory(
    db: Db,
    input: { tripId: string; seatLayoutId: string; fromSeq: number; toSeq: number; now: Date },
  ): Promise<SeatInventory> {
    // Nacheinander: Eine interaktive Transaktion hat nur eine Verbindung.
    const seats = await db.seat.findMany({
      where: { layoutId: input.seatLayoutId },
      select: {
        id: true,
        label: true,
        rowIndex: true,
        colIndex: true,
        side: true,
        isSellable: true,
      },
      orderBy: [{ rowIndex: 'asc' }, { colIndex: 'asc' }],
    });
    const tripSeats = await db.tripSeat.findMany({
      where: { tripId: input.tripId },
      select: { seatId: true, onlineSellable: true, blocked: true },
    });
    const neighbors = await db.seatNeighbor.findMany({
      where: { layoutId: input.seatLayoutId },
      select: { seatId: true, neighborSeatId: true },
    });
    const occupations = await db.$queryRaw<SeatInventory['occupations']>`
      SELECT so.seat_id AS "seatId", so.from_seq AS "fromSeq", so.to_seq AS "toSeq", so.gender
      FROM seat_occupation so
      JOIN booking b ON b.id = so.booking_id
      WHERE so.trip_id = ${input.tripId}::uuid
        AND so.from_seq < ${input.toSeq} AND so.to_seq > ${input.fromSeq}
        AND NOT ${expiredCondition(input.now)}`;
    return { seats, tripSeats, neighbors, occupations };
  }
}
