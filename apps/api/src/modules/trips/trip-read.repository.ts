import type { Gender } from '@masar/shared';

import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import type { Segment } from '../bookings/domain/seat-rules.js';

/** Ein Angebot der Suche: eine Fahrt mit Ein- und Ausstiegshalt, Tarif und freien Plätzen. */
export interface TripOfferRow {
  trip_id: string;
  gender_rule_enabled: boolean;
  company_name_ar: string;
  company_name_en: string;
  from_seq: number;
  from_departure_at: Date;
  from_station_name_ar: string;
  from_station_name_en: string;
  to_seq: number;
  to_arrival_at: Date;
  to_station_name_ar: string;
  to_station_name_en: string;
  amount_minor: number;
  currency: string;
  free_seats: number;
}

export interface TripOfferQuery {
  fromCity: string;
  toCity: string;
  /** Beginn und Ende des Suchtags in Damaskus als Zeitpunkte. */
  dayStart: Date;
  dayEnd: Date;
  now: Date;
  limit: number;
}

/**
 * Suche (docs/domaenenmodell.md, Suche und Tarif): Fahrten, deren Einstiegshalt am Suchtag in der
 * Startstadt abfährt und deren Ausstiegshalt später in der Zielstadt liegt. Gefiltert wird über die
 * Abfahrt am Einstiegshalt, nicht über den Fahrtag; so erscheint eine Nachtfahrt für Halte nach
 * Mitternacht am Folgetag. Ohne gültigen Tarif am Fahrtag erscheint das Paar nicht; dank
 * `fare_no_overlap` gibt es höchstens einen. Freie Plätze zählen nur das Online-Kontingent.
 */
export function findTripOffers(
  prisma: PrismaClient,
  query: TripOfferQuery,
): Promise<TripOfferRow[]> {
  return prisma.$queryRaw<TripOfferRow[]>`
    SELECT
      t.id AS trip_id,
      t.gender_rule_enabled,
      c.name_ar AS company_name_ar,
      c.name_en AS company_name_en,
      fs.seq AS from_seq,
      fs.departure_at AS from_departure_at,
      fst.name_ar AS from_station_name_ar,
      fst.name_en AS from_station_name_en,
      ts.seq AS to_seq,
      ts.arrival_at AS to_arrival_at,
      tst.name_ar AS to_station_name_ar,
      tst.name_en AS to_station_name_en,
      f.amount_minor,
      f.currency,
      (
        SELECT count(*)::int FROM trip_seat x
        WHERE x.trip_id = t.id AND x.online_sellable AND NOT x.blocked
          AND NOT EXISTS (
            SELECT 1 FROM seat_occupation o
            WHERE o.trip_id = t.id AND o.seat_id = x.seat_id
              AND int4range(o.from_seq, o.to_seq, '[)') && int4range(fs.seq, ts.seq, '[)')
          )
      ) AS free_seats
    FROM trip t
    JOIN company c ON c.id = t.company_id AND c.status = 'ACTIVE'
    JOIN trip_stop fs ON fs.trip_id = t.id
    JOIN station fst ON fst.id = fs.station_id
    JOIN city fc ON fc.id = fst.city_id AND fc.slug = ${query.fromCity}
    JOIN trip_stop ts ON ts.trip_id = t.id AND ts.seq > fs.seq
    JOIN station tst ON tst.id = ts.station_id
    JOIN city tc ON tc.id = tst.city_id AND tc.slug = ${query.toCity}
    JOIN fare f ON f.from_route_stop_id = fs.route_stop_id
      AND f.to_route_stop_id = ts.route_stop_id
      AND f.valid_from <= t.service_date
      AND (f.valid_until IS NULL OR f.valid_until > t.service_date)
    WHERE t.status = 'SCHEDULED'
      -- Dieselbe Grenze wie beim Buchen: Solange bar der einzige Zahlweg ist, endet die
      -- Online-Buchung bei der früheren Frist (onlineBookingCutoff).
      AND LEAST(t.online_sales_close_at, t.cash_deadline_at) > ${query.now}
      AND fs.departure_at >= ${query.dayStart}
      AND fs.departure_at < ${query.dayEnd}
    ORDER BY fs.departure_at, t.id
    LIMIT ${query.limit}`;
}

/** Alles, was der Sitzplan einer Fahrt braucht. Belegungen nur, soweit sie das Segment berühren. */
export async function loadSeatMapData(prisma: PrismaClient, tripId: string, segment: Segment) {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: {
      id: true,
      status: true,
      serviceDate: true,
      onlineSalesCloseAt: true,
      cashDeadlineAt: true,
      genderRuleEnabled: true,
      seatLayoutId: true,
      company: { select: { status: true, nameAr: true, nameEn: true } },
      seatLayout: { select: { pattern: true } },
      stops: {
        orderBy: { seq: 'asc' },
        select: {
          seq: true,
          routeStopId: true,
          arrivalAt: true,
          departureAt: true,
          station: { select: { nameAr: true, nameEn: true } },
        },
      },
    },
  });
  if (trip === null) {
    return null;
  }
  const [seats, occupations, neighbors] = await Promise.all([
    prisma.tripSeat.findMany({
      where: { tripId },
      select: {
        onlineSellable: true,
        blocked: true,
        seat: { select: { id: true, label: true, rowIndex: true, colIndex: true, side: true } },
      },
    }),
    prisma.seatOccupation.findMany({
      where: { tripId, fromSeq: { lt: segment.toSeq }, toSeq: { gt: segment.fromSeq } },
      select: { seatId: true, fromSeq: true, toSeq: true, bookingId: true, gender: true },
    }),
    prisma.seatNeighbor.findMany({
      where: { layoutId: trip.seatLayoutId },
      select: { seatId: true, neighborSeatId: true },
    }),
  ]);
  return {
    trip,
    seats,
    occupations: occupations as {
      seatId: string;
      fromSeq: number;
      toSeq: number;
      bookingId: string;
      gender: Gender | null;
    }[],
    neighbors,
  };
}

/** Der am Fahrtag gültige Tarif für ein Paar von Routenhalten, falls es einen gibt. */
export function findFare(
  prisma: PrismaClient | Prisma.TransactionClient,
  fromRouteStopId: string,
  toRouteStopId: string,
  serviceDate: Date,
) {
  return prisma.fare.findFirst({
    where: {
      fromRouteStopId,
      toRouteStopId,
      validFrom: { lte: serviceDate },
      OR: [{ validUntil: null }, { validUntil: { gt: serviceDate } }],
    },
    select: { amountMinor: true, currency: true },
  });
}
