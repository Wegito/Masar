import { Injectable } from '@nestjs/common';

import {
  type AuditActorType,
  type BookingChannel,
  type BookingStatus,
  type Gender,
  type PaymentMethod,
  type PaymentStatus,
  Prisma,
  type TicketStatus,
  type TripStatus,
} from '../../generated/prisma/client.js';
import { expiredCondition } from './bookings.repository.js';
import type { BookingListCursor, BookingSearch } from './domain/booking-list.js';

/**
 * Lesender Datenzugriff der Buchungen im Portal (Schritt 2.5, ADR 0028). Ohne Sperren: Liste,
 * Detail und Fahrgastliste sind ein Schnappschuss (Read Committed); verbindlich prüfen erst die
 * Aktionen unter der Trip-Sperre im `BookingsService`. Jede Abfrage nennt die Firma der Sitzung in
 * der Bedingung, damit eine Buchung oder Fahrt einer anderen Firma wie eine unbekannte aussieht.
 *
 * Telefonnummern verlassen dieses Repository nur für die Maskierung im Service und für das
 * ausdrückliche Anzeigen (`contact`), das der Service im Audit-Log vermerkt.
 */
type Db = Prisma.TransactionClient;

export interface BookingListFilter {
  /** Abfahrt am Starthalt in `[start, end)`; fehlende Grenze heißt offen. */
  start?: Date;
  end?: Date;
  tripId?: string;
  /** Status, wie das Personal ihn sieht (abgelaufen auch vor dem Ablauf-Job). */
  status?: BookingStatus;
  paymentMethod?: PaymentMethod;
  channel?: BookingChannel;
  search?: BookingSearch;
  cursor?: BookingListCursor;
  limit: number;
  now: Date;
}

export interface BookingListRow {
  id: string;
  bookingCode: string;
  status: BookingStatus;
  effectiveStatus: BookingStatus;
  channel: BookingChannel;
  paymentMethod: PaymentMethod | null;
  holdExpiresAt: Date | null;
  deadlineAt: Date | null;
  confirmedAt: Date | null;
  totalAmountMinor: number;
  currency: string;
  contactName: string;
  contactPhoneE164: string;
  createdAt: Date;
  passengerCount: number;
  paymentStatuses: PaymentStatus[];
  tripId: string;
  tripDepartureAt: Date;
  tripStatus: TripStatus;
  routeId: string;
  routeNameAr: string;
  routeNameEn: string;
  fromTripStopId: string;
  fromSeq: number;
  fromNameAr: string;
  fromNameEn: string;
  fromArrivalAt: Date | null;
  fromDepartureAt: Date | null;
  toTripStopId: string;
  toSeq: number;
  toNameAr: string;
  toNameEn: string;
  toArrivalAt: Date | null;
  toDepartureAt: Date | null;
}

/**
 * Status mit Fristablauf wie `effectiveBookingStatus`: Buchungen nach der Frist zählen als
 * `EXPIRED`, auch wenn der Ablauf-Job sie noch nicht freigegeben hat.
 */
function effectiveStatusSql(now: Date): Prisma.Sql {
  return Prisma.sql`(CASE WHEN ${expiredCondition(now)} THEN 'EXPIRED' ELSE b.status::text END)`;
}

export const BOOKING_DETAIL_SELECT = {
  id: true,
  companyId: true,
  bookingCode: true,
  status: true,
  channel: true,
  paymentMethod: true,
  locale: true,
  holdExpiresAt: true,
  deadlineAt: true,
  fareAmountMinor: true,
  totalAmountMinor: true,
  currency: true,
  contactName: true,
  contactPhoneE164: true,
  contactEmail: true,
  createdAt: true,
  confirmedAt: true,
  cancelledAt: true,
  cancelledBy: true,
  cancelReason: true,
  piiPurgedAt: true,
  trip: {
    select: {
      id: true,
      status: true,
      departureAt: true,
      arrivalAt: true,
      route: { select: { id: true, nameAr: true, nameEn: true } },
      bus: { select: { id: true, plate: true } },
    },
  },
  fromTripStop: {
    select: {
      id: true,
      seq: true,
      arrivalAt: true,
      departureAt: true,
      station: { select: { nameAr: true, nameEn: true } },
    },
  },
  toTripStop: {
    select: {
      id: true,
      seq: true,
      arrivalAt: true,
      departureAt: true,
      station: { select: { nameAr: true, nameEn: true } },
    },
  },
  passengers: {
    select: {
      id: true,
      seatId: true,
      fullName: true,
      gender: true,
      // Nur, ob eine Ausweisnummer gespeichert ist; Klartext und letzte Ziffern nie (ADR 0028).
      nationalIdKeyId: true,
      status: true,
      tripSeat: { select: { seat: { select: { label: true, rowIndex: true, colIndex: true } } } },
    },
  },
  tickets: { select: { id: true, bookingPassengerId: true, seatLabel: true, status: true } },
  payments: {
    select: {
      id: true,
      method: true,
      status: true,
      amountMinor: true,
      currency: true,
      createdAt: true,
      confirmedAt: true,
    },
    orderBy: { createdAt: 'asc' },
  },
} as const satisfies Prisma.BookingSelect;

export type BookingDetailRecord = Prisma.BookingGetPayload<{
  select: typeof BOOKING_DETAIL_SELECT;
}>;

export interface HistoryRow {
  occurredAt: Date;
  action: string;
  actorType: AuditActorType;
  actorId: string | null;
  reason: string | null;
  data: Prisma.JsonValue;
}

export interface PassengerRow {
  passengerId: string;
  bookingId: string;
  seatId: string;
  seatLabel: string;
  row: number;
  column: number;
  fullName: string;
  gender: Gender | null;
  nationalIdPresent: boolean;
  bookingStatus: BookingStatus;
  channel: BookingChannel;
  paymentMethod: PaymentMethod | null;
  confirmedAt: Date | null;
  paymentStatuses: PaymentStatus[];
  ticketStatus: TicketStatus | null;
  fromSeq: number;
  toSeq: number;
  fromTripStopId: string;
  toTripStopId: string;
}

export interface PassengerTripRecord {
  id: string;
  status: TripStatus;
  departureAt: Date;
  arrivalAt: Date;
  route: { id: string; nameAr: string; nameEn: string };
  bus: { id: string; plate: string } | null;
  stops: {
    id: string;
    seq: number;
    arrivalAt: Date | null;
    departureAt: Date | null;
    station: { id: string; nameAr: string; nameEn: string };
  }[];
}

@Injectable()
export class CompanyBookingsRepository {
  /** Buchungen der Firma nach Abfahrt der Fahrt, dann ID (Keyset); `limit` inklusive Vorschau. */
  async listBookings(
    db: Db,
    companyId: string,
    filter: BookingListFilter,
  ): Promise<BookingListRow[]> {
    const effective = effectiveStatusSql(filter.now);
    const conditions: Prisma.Sql[] = [Prisma.sql`b.company_id = ${companyId}::uuid`];
    if (filter.start !== undefined) {
      conditions.push(Prisma.sql`t.departure_at >= ${filter.start}::timestamptz`);
    }
    if (filter.end !== undefined) {
      conditions.push(Prisma.sql`t.departure_at < ${filter.end}::timestamptz`);
    }
    if (filter.tripId !== undefined) {
      conditions.push(Prisma.sql`b.trip_id = ${filter.tripId}::uuid`);
    }
    if (filter.status !== undefined) {
      conditions.push(Prisma.sql`${effective} = ${filter.status}`);
    }
    if (filter.paymentMethod !== undefined) {
      conditions.push(Prisma.sql`b.payment_method = ${filter.paymentMethod}::"PaymentMethod"`);
    }
    if (filter.channel !== undefined) {
      conditions.push(Prisma.sql`b.channel = ${filter.channel}::"BookingChannel"`);
    }
    if (filter.search !== undefined) {
      // Nur Code-Anfang und Telefon-Ende. Beide Werte bestehen nach parseBookingSearch nur aus
      // Zeichen des Code-Alphabets bzw. Ziffern, also ohne LIKE-Platzhalter.
      const alternatives: Prisma.Sql[] = [];
      if (filter.search.codePrefix !== null) {
        alternatives.push(Prisma.sql`b.booking_code LIKE ${`${filter.search.codePrefix}%`}`);
      }
      if (filter.search.phoneSuffix !== null) {
        alternatives.push(Prisma.sql`b.contact_phone_e164 LIKE ${`%${filter.search.phoneSuffix}`}`);
      }
      conditions.push(Prisma.sql`(${Prisma.join(alternatives, ' OR ')})`);
    }
    if (filter.cursor !== undefined) {
      conditions.push(
        Prisma.sql`(t.departure_at, b.id) > (${filter.cursor.departureAt}::timestamptz, ${filter.cursor.bookingId}::uuid)`,
      );
    }
    return db.$queryRaw<BookingListRow[]>`
      SELECT b.id, b.booking_code AS "bookingCode", b.status, ${effective} AS "effectiveStatus",
             b.channel, b.payment_method AS "paymentMethod", b.hold_expires_at AS "holdExpiresAt",
             b.deadline_at AS "deadlineAt", b.confirmed_at AS "confirmedAt",
             b.total_amount_minor AS "totalAmountMinor", b.currency,
             b.contact_name AS "contactName", b.contact_phone_e164 AS "contactPhoneE164",
             b.created_at AS "createdAt",
             (SELECT count(*)::int FROM booking_passenger p WHERE p.booking_id = b.id)
               AS "passengerCount",
             COALESCE((SELECT array_agg(pay.status::text ORDER BY pay.created_at)
                       FROM payment pay WHERE pay.booking_id = b.id), ARRAY[]::text[])
               AS "paymentStatuses",
             t.id AS "tripId", t.departure_at AS "tripDepartureAt", t.status AS "tripStatus",
             r.id AS "routeId", r.name_ar AS "routeNameAr", r.name_en AS "routeNameEn",
             fs.id AS "fromTripStopId", fs.seq AS "fromSeq", fst.name_ar AS "fromNameAr",
             fst.name_en AS "fromNameEn", fs.arrival_at AS "fromArrivalAt",
             fs.departure_at AS "fromDepartureAt",
             ts.id AS "toTripStopId", ts.seq AS "toSeq", tst.name_ar AS "toNameAr",
             tst.name_en AS "toNameEn", ts.arrival_at AS "toArrivalAt",
             ts.departure_at AS "toDepartureAt"
      FROM booking b
      JOIN trip t ON t.id = b.trip_id AND t.company_id = b.company_id
      JOIN route r ON r.id = t.route_id
      JOIN trip_stop fs ON fs.id = b.from_trip_stop_id
      JOIN station fst ON fst.id = fs.station_id
      JOIN trip_stop ts ON ts.id = b.to_trip_stop_id
      JOIN station tst ON tst.id = ts.station_id
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY t.departure_at, b.id
      LIMIT ${filter.limit}`;
  }

  /** Eine Buchung der Firma; eine fremde ist `null` wie eine unbekannte. */
  async findDetail(
    db: Db,
    companyId: string,
    bookingId: string,
  ): Promise<BookingDetailRecord | null> {
    return db.booking.findFirst({
      where: { id: bookingId, companyId },
      select: BOOKING_DETAIL_SELECT,
    });
  }

  /** Verlauf aus dem Audit-Log, ältester Eintrag zuerst. */
  async history(db: Db, companyId: string, bookingId: string): Promise<HistoryRow[]> {
    return db.auditLog.findMany({
      where: { entityType: 'booking', entityId: bookingId, companyId },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      select: {
        occurredAt: true,
        action: true,
        actorType: true,
        actorId: true,
        reason: true,
        data: true,
      },
    });
  }

  /** Kontaktdaten im Klartext, nur für das ausdrückliche Anzeigen mit Audit-Eintrag. */
  async contact(
    db: Db,
    companyId: string,
    bookingId: string,
  ): Promise<{
    contactPhoneE164: string;
    contactEmail: string | null;
    piiPurgedAt: Date | null;
  } | null> {
    return db.booking.findFirst({
      where: { id: bookingId, companyId },
      select: { contactPhoneE164: true, contactEmail: true, piiPurgedAt: true },
    });
  }

  async passengerTrip(
    db: Db,
    companyId: string,
    tripId: string,
  ): Promise<PassengerTripRecord | null> {
    return db.trip.findFirst({
      where: { id: tripId, companyId },
      select: {
        id: true,
        status: true,
        departureAt: true,
        arrivalAt: true,
        route: { select: { id: true, nameAr: true, nameEn: true } },
        bus: { select: { id: true, plate: true } },
        stops: {
          orderBy: { seq: 'asc' },
          select: {
            id: true,
            seq: true,
            arrivalAt: true,
            departureAt: true,
            station: { select: { id: true, nameAr: true, nameEn: true } },
          },
        },
      },
    });
  }

  /**
   * Aktive Fahrgäste aktiver Buchungen einer (bereits als eigene geprüften) Fahrt, nach Sitz
   * (Reihe, Spalte) und Einstieg. Buchungen nach Fristablauf zählen nicht mehr, auch wenn der
   * Ablauf-Job sie noch nicht freigegeben hat.
   */
  async tripPassengers(db: Db, tripId: string, now: Date): Promise<PassengerRow[]> {
    return db.$queryRaw<PassengerRow[]>`
      SELECT p.id AS "passengerId", b.id AS "bookingId", p.seat_id AS "seatId",
             s.label AS "seatLabel", s.row_index AS "row", s.col_index AS "column",
             p.full_name AS "fullName", p.gender,
             (p.national_id_encrypted IS NOT NULL) AS "nationalIdPresent",
             b.status AS "bookingStatus", b.channel,
             b.payment_method AS "paymentMethod", b.confirmed_at AS "confirmedAt",
             COALESCE((SELECT array_agg(pay.status::text ORDER BY pay.created_at)
                       FROM payment pay WHERE pay.booking_id = b.id), ARRAY[]::text[])
               AS "paymentStatuses",
             tk.status AS "ticketStatus",
             b.from_seq AS "fromSeq", b.to_seq AS "toSeq",
             b.from_trip_stop_id AS "fromTripStopId", b.to_trip_stop_id AS "toTripStopId"
      FROM booking_passenger p
      JOIN booking b ON b.id = p.booking_id
      JOIN seat s ON s.id = p.seat_id
      LEFT JOIN ticket tk ON tk.booking_passenger_id = p.id
      WHERE b.trip_id = ${tripId}::uuid
        AND p.status = 'ACTIVE'
        AND b.status IN ('HELD', 'RESERVED', 'PENDING_CONFIRMATION', 'CONFIRMED')
        AND NOT ${expiredCondition(now)}
      ORDER BY s.row_index, s.col_index, b.from_seq, p.id`;
  }
}
