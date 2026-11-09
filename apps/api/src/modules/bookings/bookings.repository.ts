import { Injectable } from '@nestjs/common';

import {
  type BookingChannel,
  type BookingStatus,
  type CancelActor,
  type CompanyStatus,
  type Gender,
  type Locale,
  type PaymentMethod,
  Prisma,
  type TripStatus,
} from '../../generated/prisma/client.js';
import type { ExistingOccupation } from './domain/seat-selection.js';
import { hashSecret } from './domain/secrets.js';

/**
 * Datenzugriff des Buchungskerns. Schreibende Abfragen sind SQL (ADR 0004): Prisma kann Zeilen mit
 * überlappenden zusammengesetzten Fremdschlüsseln (ADR 0018) nicht anlegen, und Sperren sollen
 * genau so dastehen, wie sie gemeint sind. Jede Methode bekommt den Transaktions-Client; die
 * Transaktionsgrenze zieht der Service.
 *
 * Zeitpunkte kommen als Parameter (`now`) aus der Uhr der Anwendung, nie aus `now()` der Datenbank:
 * Fristen, die die Anwendung setzt, prüft so dieselbe Uhr.
 */
type Db = Prisma.TransactionClient;

export interface LockedTrip {
  id: string;
  companyId: string;
  status: TripStatus;
  routeId: string;
  seatLayoutId: string;
  serviceDate: Date;
  departureAt: Date;
  onlineSalesCloseAt: Date;
  cashDeadlineAt: Date | null;
  genderRuleEnabled: boolean;
  companyStatus: CompanyStatus;
  requireNationalId: boolean;
  holdMinutes: number;
  cashDeadlineMinutes: number;
}

export interface LockedBooking {
  id: string;
  companyId: string;
  tripId: string;
  status: BookingStatus;
  channel: BookingChannel;
  fromSeq: number;
  toSeq: number;
  holdExpiresAt: Date | null;
  deadlineAt: Date | null;
  totalAmountMinor: number;
  currency: string;
}

export interface ExpiredBooking {
  id: string;
  companyId: string;
  previousStatus: BookingStatus;
}

export interface NewBooking {
  companyId: string;
  tripId: string;
  bookingCode: string;
  channel: BookingChannel;
  /**
   * `HELD` für die Gastbuchung (mit `holdExpiresAt`); `CONFIRMED` für den Barverkauf am Schalter
   * (Schritt 2.6, ADR 0030) mit `paymentMethod`, `confirmedAt` und eingefrorener Provision.
   */
  status: 'HELD' | 'CONFIRMED';
  fromTripStopId: string;
  toTripStopId: string;
  fromSeq: number;
  toSeq: number;
  contactName: string;
  contactPhoneE164: string;
  contactEmail: string | null;
  locale: Locale;
  holdExpiresAt: Date | null;
  paymentMethod: PaymentMethod | null;
  confirmedAt: Date | null;
  commissionRateBps: number | null;
  commissionAmountMinor: number | null;
  fareAmountMinor: number;
  totalAmountMinor: number;
  currency: string;
  /** Ohne Verwaltungstoken (`null`) am Schalter: Der Fahrgast liest das Ticket mit Code und Telefon. */
  manageTokenHash: string | null;
  /** Der gesendete Schlüssel; gespeichert wird nur sein SHA-256 (`hashSecret`, ADR 0020). */
  idempotencyKey: string | null;
  piiPurgeAfter: Date;
  now: Date;
}

export interface NewPassenger {
  id: string;
  bookingId: string;
  tripId: string;
  seatId: string;
  fullName: string;
  gender: Gender | null;
  nationalIdEncrypted: Buffer | null;
  nationalIdKeyId: string | null;
  nationalIdLast4: string | null;
  piiPurgeAfter: Date;
  now: Date;
}

/**
 * Abgelaufene, aktive, unbestätigte Buchungen (Alias `b`); dieselbe Regel wie `isPastDeadline` und
 * `effectiveBookingStatus`.
 */
export function expiredCondition(now: Date): Prisma.Sql {
  return Prisma.sql`(
    (b.status = 'HELD' AND b.hold_expires_at <= ${now}::timestamptz)
    OR (b.status IN ('RESERVED', 'PENDING_CONFIRMATION') AND b.deadline_at <= ${now}::timestamptz)
  )`;
}

@Injectable()
export class BookingsRepository {
  /**
   * Serialisierungspunkt je Fahrt (ADR 0005): `SELECT … FOR UPDATE` auf die Trip-Zeile, mit den
   * Firmeneinstellungen, die die Prüfung braucht. Nur die Fahrt wird gesperrt, nicht die Firma.
   * Mit `skipLocked` gibt der Ablauf-Job eine gerade gesperrte Fahrt an die laufende Buchung ab.
   */
  async lockTrip(
    db: Db,
    tripId: string,
    options: { skipLocked?: boolean } = {},
  ): Promise<LockedTrip | null> {
    return this.tripRow(
      db,
      tripId,
      options.skipLocked === true
        ? Prisma.sql`FOR UPDATE OF t SKIP LOCKED`
        : Prisma.sql`FOR UPDATE OF t`,
    );
  }

  /**
   * Dieselben Felder wie {@link lockTrip}, ohne Sperre: für Vorschau und Sitzplan des Schalters
   * (Schritt 2.6). Verbindlich prüft erst der Verkauf unter der Sperre.
   */
  async findTrip(db: Db, tripId: string): Promise<LockedTrip | null> {
    return this.tripRow(db, tripId, Prisma.empty);
  }

  private async tripRow(db: Db, tripId: string, lock: Prisma.Sql): Promise<LockedTrip | null> {
    const rows = await db.$queryRaw<LockedTrip[]>`
      SELECT t.id, t.company_id AS "companyId", t.status, t.route_id AS "routeId",
             t.seat_layout_id AS "seatLayoutId", t.service_date AS "serviceDate",
             t.departure_at AS "departureAt", t.online_sales_close_at AS "onlineSalesCloseAt",
             t.cash_deadline_at AS "cashDeadlineAt", t.gender_rule_enabled AS "genderRuleEnabled",
             c.status AS "companyStatus", c.require_national_id AS "requireNationalId",
             c.hold_minutes AS "holdMinutes", c.cash_deadline_minutes AS "cashDeadlineMinutes"
      FROM trip t
      JOIN company c ON c.id = t.company_id
      WHERE t.id = ${tripId}::uuid
      ${lock}`;
    return rows[0] ?? null;
  }

  /** Zweite Sperre nach der Fahrt (Reihenfolge Trip → Booking → Payment, AGENTS.md). */
  async lockBooking(db: Db, bookingId: string): Promise<LockedBooking | null> {
    const rows = await db.$queryRaw<LockedBooking[]>`
      SELECT id, company_id AS "companyId", trip_id AS "tripId", status, channel,
             from_seq AS "fromSeq", to_seq AS "toSeq", hold_expires_at AS "holdExpiresAt",
             deadline_at AS "deadlineAt", total_amount_minor AS "totalAmountMinor", currency
      FROM booking
      WHERE id = ${bookingId}::uuid
      FOR UPDATE`;
    return rows[0] ?? null;
  }

  /**
   * Setzt abgelaufene Buchungen der (bereits gesperrten) Fahrt auf `EXPIRED` und löscht ihre
   * Belegungen in derselben Anweisung. Liefert die betroffenen Buchungen mit dem Status davor.
   */
  /**
   * Alle aktiven Buchungen einer Fahrt, gesperrt in fester Reihenfolge (nach ID), für die Absage
   * der Fahrt (Schritt 2.4). Nur unter der Trip-Sperre aufrufen: Trip → Booking.
   */
  async lockActiveBookings(db: Db, tripId: string): Promise<LockedBooking[]> {
    return db.$queryRaw<LockedBooking[]>`
      SELECT id, company_id AS "companyId", trip_id AS "tripId", status, channel,
             from_seq AS "fromSeq", to_seq AS "toSeq", hold_expires_at AS "holdExpiresAt",
             deadline_at AS "deadlineAt", total_amount_minor AS "totalAmountMinor", currency
      FROM booking
      WHERE trip_id = ${tripId}::uuid
        AND status IN ('HELD', 'RESERVED', 'PENDING_CONFIRMATION', 'CONFIRMED')
      ORDER BY id
      FOR UPDATE`;
  }

  async releaseExpired(db: Db, tripId: string, now: Date): Promise<ExpiredBooking[]> {
    return db.$queryRaw<ExpiredBooking[]>`
      WITH target AS (
        SELECT b.id, b.status
        FROM booking b
        WHERE b.trip_id = ${tripId}::uuid AND ${expiredCondition(now)}
        FOR UPDATE
      ),
      expired AS (
        UPDATE booking b
        SET status = 'EXPIRED', version = b.version + 1, updated_at = ${now}::timestamptz
        FROM target
        WHERE b.id = target.id
        RETURNING b.id, b.company_id, target.status AS previous_status
      ),
      freed AS (
        DELETE FROM seat_occupation so USING expired e WHERE so.booking_id = e.id
        RETURNING so.id
      )
      SELECT e.id, e.company_id AS "companyId", e.previous_status AS "previousStatus"
      FROM expired e
      ORDER BY e.id`;
  }

  /** Fahrten mit abgelaufenen Buchungen, für den minütlichen Job. */
  async tripsWithExpiredBookings(db: Db, now: Date, limit: number): Promise<string[]> {
    const rows = await db.$queryRaw<{ tripId: string }[]>`
      SELECT DISTINCT b.trip_id AS "tripId"
      FROM booking b
      WHERE ${expiredCondition(now)}
      LIMIT ${limit}`;
    return rows.map((row) => row.tripId);
  }

  async findStops(
    db: Db,
    tripId: string,
  ): Promise<{ id: string; seq: number; routeStopId: string }[]> {
    return db.tripStop.findMany({
      where: { tripId },
      select: { id: true, seq: true, routeStopId: true },
      orderBy: { seq: 'asc' },
    });
  }

  /** Gültiger Tarif für das Paar am Fahrtag (halboffen; `fare_no_overlap` garantiert höchstens einen). */
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

  /** Angefragte Sitze im Sitzplan der Fahrt, ihr Kontingent und ihre Nachbarpaare. */
  async findSeats(
    db: Db,
    input: { tripId: string; seatLayoutId: string; seatIds: string[] },
  ): Promise<{
    seats: { id: string; label: string; isSellable: boolean }[];
    tripSeats: { seatId: string; onlineSellable: boolean; blocked: boolean }[];
    neighbors: { seatId: string; neighborSeatId: string }[];
  }> {
    const seats = await db.seat.findMany({
      where: { layoutId: input.seatLayoutId, id: { in: input.seatIds } },
      select: { id: true, label: true, isSellable: true },
    });
    const tripSeats = await db.tripSeat.findMany({
      where: { tripId: input.tripId, seatId: { in: input.seatIds } },
      select: { seatId: true, onlineSellable: true, blocked: true },
    });
    // Beide Richtungen, weil die Datenbank die Symmetrie nicht erzwingt (Umsetzung 1.2).
    const neighbors = await db.seatNeighbor.findMany({
      where: {
        layoutId: input.seatLayoutId,
        OR: [{ seatId: { in: input.seatIds } }, { neighborSeatId: { in: input.seatIds } }],
      },
      select: { seatId: true, neighborSeatId: true },
    });
    return { seats, tripSeats, neighbors };
  }

  /**
   * Belegungen der Fahrt, die die Teilstrecke überlappen (halboffen). Mit `activeAt` ohne die
   * Belegungen abgelaufener, noch nicht freigegebener Buchungen (Lesen ohne Sperre, Schritt 2.6).
   */
  async findOverlappingOccupations(
    db: Db,
    input: { tripId: string; fromSeq: number; toSeq: number; activeAt?: Date },
  ): Promise<ExistingOccupation[]> {
    if (input.activeAt !== undefined) {
      return db.$queryRaw<ExistingOccupation[]>`
        SELECT so.seat_id AS "seatId", so.from_seq AS "fromSeq", so.to_seq AS "toSeq",
               so.booking_id AS "bookingId", so.gender
        FROM seat_occupation so
        JOIN booking b ON b.id = so.booking_id
        WHERE so.trip_id = ${input.tripId}::uuid
          AND so.from_seq < ${input.toSeq} AND so.to_seq > ${input.fromSeq}
          AND NOT ${expiredCondition(input.activeAt)}`;
    }
    return db.seatOccupation.findMany({
      where: { tripId: input.tripId, fromSeq: { lt: input.toSeq }, toSeq: { gt: input.fromSeq } },
      select: { seatId: true, fromSeq: true, toSeq: true, bookingId: true, gender: true },
    });
  }

  /** Offene, noch nicht abgelaufene, unbestätigte Buchungen einer Telefonnummer (alle Fahrten). */
  async countOpenBookingsForPhone(db: Db, phoneE164: string, now: Date): Promise<number> {
    return db.booking.count({
      where: {
        contactPhoneE164: phoneE164,
        OR: [
          { status: 'HELD', holdExpiresAt: { gt: now } },
          { status: { in: ['RESERVED', 'PENDING_CONFIRMATION'] }, deadlineAt: { gt: now } },
        ],
      },
    });
  }

  /**
   * Sucht über den SHA-256 des Schlüssels: Die Spalte `idempotency_key` enthält nie den Klartext,
   * weil eine Wiederholung ein neues Verwaltungstoken ausgibt (ADR 0020, Nachtrag 2026-11-04).
   */
  async findByIdempotencyKey(
    db: Db,
    key: string,
  ): Promise<{
    id: string;
    companyId: string;
    channel: BookingChannel;
    tripId: string;
    fromTripStopId: string;
    toTripStopId: string;
    seatIds: string[];
  } | null> {
    const booking = await db.booking.findUnique({
      where: { idempotencyKey: hashSecret(key) },
      select: {
        id: true,
        companyId: true,
        channel: true,
        tripId: true,
        fromTripStopId: true,
        toTripStopId: true,
        passengers: { select: { seatId: true } },
      },
    });
    if (booking === null) {
      return null;
    }
    const { passengers, ...rest } = booking;
    return { ...rest, seatIds: passengers.map((passenger) => passenger.seatId) };
  }

  /** IDs aus der Datenbank (`uuidv7()`, ADR 0013), bevor die Zeilen entstehen: Die Ausweisnummer braucht die Fahrgast-ID als Associated Data. */
  async newIds(db: Db, count: number): Promise<string[]> {
    const rows = await db.$queryRaw<{ id: string }[]>`
      SELECT uuidv7()::text AS id FROM generate_series(1, ${count}::int)`;
    return rows.map((row) => row.id);
  }

  /**
   * Legt die Buchung an. Eine Kollision des Buchungscodes ergibt `null` statt eines Fehlers, damit
   * die Transaktion weiterläuft und der Service neu würfeln kann. Eine Kollision des
   * Idempotenz-Schlüssels bleibt ein Fehler (`23505`) und bricht die Transaktion ab.
   */
  async insertBooking(db: Db, input: NewBooking): Promise<string | null> {
    const rows = await db.$queryRaw<{ id: string }[]>`
      INSERT INTO booking
        (company_id, trip_id, booking_code, status, channel, payment_method, from_trip_stop_id,
         to_trip_stop_id, from_seq, to_seq, contact_name, contact_phone_e164, contact_email, locale,
         hold_expires_at, confirmed_at, fare_amount_minor, total_amount_minor, currency,
         commission_rate_bps, commission_amount_minor, manage_token_hash, idempotency_key,
         pii_purge_after, created_at, updated_at)
      VALUES
        (${input.companyId}::uuid, ${input.tripId}::uuid, ${input.bookingCode},
         ${input.status}::"BookingStatus", ${input.channel}::"BookingChannel",
         ${input.paymentMethod}::"PaymentMethod", ${input.fromTripStopId}::uuid,
         ${input.toTripStopId}::uuid, ${input.fromSeq}, ${input.toSeq}, ${input.contactName},
         ${input.contactPhoneE164}, ${input.contactEmail}, ${input.locale}::"Locale",
         ${input.holdExpiresAt}::timestamptz, ${input.confirmedAt}::timestamptz,
         ${input.fareAmountMinor}, ${input.totalAmountMinor}, ${input.currency},
         ${input.commissionRateBps}, ${input.commissionAmountMinor}, ${input.manageTokenHash},
         ${input.idempotencyKey === null ? null : hashSecret(input.idempotencyKey)},
         ${input.piiPurgeAfter}::timestamptz, ${input.now}::timestamptz,
         ${input.now}::timestamptz)
      ON CONFLICT (booking_code) DO NOTHING
      RETURNING id`;
    return rows[0]?.id ?? null;
  }

  async insertPassenger(db: Db, input: NewPassenger): Promise<void> {
    await db.$executeRaw`
      INSERT INTO booking_passenger
        (id, booking_id, trip_id, seat_id, full_name, gender, national_id_encrypted,
         national_id_key_id, national_id_last4, pii_purge_after, created_at, updated_at)
      VALUES
        (${input.id}::uuid, ${input.bookingId}::uuid, ${input.tripId}::uuid, ${input.seatId}::uuid,
         ${input.fullName}, ${input.gender}::"Gender", ${input.nationalIdEncrypted},
         ${input.nationalIdKeyId}, ${input.nationalIdLast4}, ${input.piiPurgeAfter}::timestamptz,
         ${input.now}::timestamptz, ${input.now}::timestamptz)`;
  }

  /**
   * Belegt die Sitze aller aktiven Fahrgäste mit der Teilstrecke der Buchung. Einziger Schreibpfad
   * in `seat_occupation` neben dem Löschen; läuft nur unter der Trip-Sperre.
   */
  async occupySeats(db: Db, bookingId: string, now: Date): Promise<number> {
    return db.$executeRaw`
      INSERT INTO seat_occupation
        (trip_id, seat_id, from_seq, to_seq, booking_id, booking_passenger_id, gender, created_at,
         updated_at)
      SELECT p.trip_id, p.seat_id, b.from_seq, b.to_seq, b.id, p.id, p.gender,
             ${now}::timestamptz, ${now}::timestamptz
      FROM booking_passenger p
      JOIN booking b ON b.id = p.booking_id
      WHERE b.id = ${bookingId}::uuid AND p.status = 'ACTIVE'`;
  }

  async markReservedCash(
    db: Db,
    input: { bookingId: string; deadlineAt: Date; now: Date },
  ): Promise<void> {
    await db.$executeRaw`
      UPDATE booking
      SET status = 'RESERVED', payment_method = 'CASH', deadline_at = ${input.deadlineAt}::timestamptz,
          version = version + 1, updated_at = ${input.now}::timestamptz
      WHERE id = ${input.bookingId}::uuid`;
  }

  async findCommissionRateBps(
    db: Db,
    companyId: string,
    serviceDate: Date,
  ): Promise<number | null> {
    const rate = await db.commissionRate.findFirst({
      where: {
        companyId,
        validFrom: { lte: serviceDate },
        OR: [{ validUntil: null }, { validUntil: { gt: serviceDate } }],
      },
      select: { rateBps: true },
    });
    return rate?.rateBps ?? null;
  }

  async activePassengersWithSeats(
    db: Db,
    bookingId: string,
  ): Promise<{ id: string; seatLabel: string }[]> {
    return db.$queryRaw<{ id: string; seatLabel: string }[]>`
      SELECT p.id, s.label AS "seatLabel"
      FROM booking_passenger p
      JOIN seat s ON s.id = p.seat_id
      WHERE p.booking_id = ${bookingId}::uuid AND p.status = 'ACTIVE'
      ORDER BY s.row_index, s.col_index`;
  }

  async insertTicket(
    db: Db,
    input: {
      /** Vorab per `newIds`, weil der Hash des QR-Tokens aus der ID abgeleitet wird (ADR 0022). */
      id: string;
      passengerId: string;
      bookingId: string;
      tripId: string;
      companyId: string;
      seatLabel: string;
      qrTokenHash: string;
      now: Date;
    },
  ): Promise<void> {
    await db.$executeRaw`
      INSERT INTO ticket
        (id, booking_passenger_id, booking_id, trip_id, company_id, seat_label, qr_token_hash,
         created_at, updated_at)
      VALUES
        (${input.id}::uuid, ${input.passengerId}::uuid, ${input.bookingId}::uuid, ${input.tripId}::uuid,
         ${input.companyId}::uuid, ${input.seatLabel}, ${input.qrTokenHash},
         ${input.now}::timestamptz, ${input.now}::timestamptz)`;
  }

  async markConfirmed(
    db: Db,
    input: {
      bookingId: string;
      commissionRateBps: number;
      commissionAmountMinor: number;
      now: Date;
    },
  ): Promise<void> {
    await db.$executeRaw`
      UPDATE booking
      SET status = 'CONFIRMED', confirmed_at = ${input.now}::timestamptz,
          commission_rate_bps = ${input.commissionRateBps},
          commission_amount_minor = ${input.commissionAmountMinor},
          version = version + 1, updated_at = ${input.now}::timestamptz
      WHERE id = ${input.bookingId}::uuid`;
  }

  async anyTicketCheckedIn(db: Db, bookingId: string): Promise<boolean> {
    const count = await db.ticket.count({ where: { bookingId, status: 'CHECKED_IN' } });
    return count > 0;
  }

  async cancellationPolicy(
    db: Db,
    tripId: string,
  ): Promise<{
    allowPassengerCancel: boolean;
    rules: { minMinutesBeforeDeparture: number; feeBps: number }[];
  }> {
    const trip = await db.trip.findUniqueOrThrow({
      where: { id: tripId },
      select: {
        route: {
          select: {
            cancellationPolicy: {
              select: {
                allowPassengerCancel: true,
                rules: { select: { minMinutesBeforeDeparture: true, feeBps: true } },
              },
            },
          },
        },
      },
    });
    return trip.route.cancellationPolicy;
  }

  /**
   * Storno in einer Folge: Belegung löschen, Tickets entwerten, Fahrgäste und Buchung auf
   * `CANCELLED`. Alles in der Transaktion des Aufrufers unter der Trip-Sperre.
   */
  async cancel(
    db: Db,
    input: {
      bookingId: string;
      actor: CancelActor;
      actorUserId: string | null;
      reason: string | null;
      now: Date;
    },
  ): Promise<{ seatsFreed: number; ticketsVoided: number }> {
    const seatsFreed = await db.$executeRaw`
      DELETE FROM seat_occupation WHERE booking_id = ${input.bookingId}::uuid`;
    const ticketsVoided = await db.$executeRaw`
      UPDATE ticket SET status = 'VOID', version = version + 1, updated_at = ${input.now}::timestamptz
      WHERE booking_id = ${input.bookingId}::uuid AND status = 'ISSUED'`;
    await db.$executeRaw`
      UPDATE booking_passenger SET status = 'CANCELLED', updated_at = ${input.now}::timestamptz
      WHERE booking_id = ${input.bookingId}::uuid AND status = 'ACTIVE'`;
    await db.$executeRaw`
      UPDATE booking
      SET status = 'CANCELLED', cancelled_at = ${input.now}::timestamptz,
          cancelled_by = ${input.actor}::"CancelActor", cancelled_by_user_id = ${input.actorUserId}::uuid,
          cancel_reason = ${input.reason}, version = version + 1, updated_at = ${input.now}::timestamptz
      WHERE id = ${input.bookingId}::uuid`;
    return { seatsFreed, ticketsVoided };
  }

  async setManageTokenHash(db: Db, bookingId: string, hash: string, now: Date): Promise<void> {
    await db.$executeRaw`
      UPDATE booking SET manage_token_hash = ${hash}, updated_at = ${now}::timestamptz
      WHERE id = ${bookingId}::uuid`;
  }

  /** Zugriffsdaten ohne Sperre: Fahrt, Firma und Hash des Verwaltungstokens. */
  async findAccess(
    db: Db,
    bookingId: string,
  ): Promise<{
    id: string;
    tripId: string;
    companyId: string;
    manageTokenHash: string | null;
  } | null> {
    return db.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, tripId: true, companyId: true, manageTokenHash: true },
    });
  }

  async findIdByCode(db: Db, companyId: string, bookingCode: string): Promise<string | null> {
    const booking = await db.booking.findFirst({
      where: { companyId, bookingCode },
      select: { id: true },
    });
    return booking?.id ?? null;
  }

  async findView(db: Db, bookingId: string): Promise<BookingRecord | null> {
    return db.booking.findUnique({ where: { id: bookingId }, select: BOOKING_VIEW_SELECT });
  }

  /** Für die Suche nach Code und Telefon: nur ID und Telefon, über den eindeutigen Code. */
  async findByCode(
    db: Db,
    bookingCode: string,
  ): Promise<{ id: string; contactPhoneE164: string } | null> {
    return db.booking.findUnique({
      where: { bookingCode },
      select: { id: true, contactPhoneE164: true },
    });
  }

  /** Daten der Ticketseite: Buchung, Halte der Teilstrecke, Fahrgäste, Tickets mit Version. */
  async findTicketView(db: Db, bookingId: string): Promise<TicketRecord | null> {
    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      select: TICKET_VIEW_SELECT,
    });
    if (booking === null) {
      return null;
    }
    const stops = await db.tripStop.findMany({
      where: { tripId: booking.trip.id, seq: { gte: booking.fromSeq, lte: booking.toSeq } },
      orderBy: { seq: 'asc' },
      select: STOP_VIEW_SELECT,
    });
    return { ...booking, stops };
  }

  /**
   * Ersetzt den Hash des QR-Tokens, wenn er nicht zur aktuellen Ableitung passt (Ticket aus der
   * Zeit vor ADR 0022 oder neuer Schlüssel). Nur für ausgestellte, nicht eingecheckte Tickets.
   */
  async rekeyTicket(db: Db, ticketId: string, qrTokenHash: string, now: Date): Promise<boolean> {
    const updated = await db.$executeRaw`
      UPDATE ticket SET qr_token_hash = ${qrTokenHash}, updated_at = ${now}::timestamptz
      WHERE id = ${ticketId}::uuid AND status = 'ISSUED' AND qr_token_hash <> ${qrTokenHash}`;
    return updated > 0;
  }
}

const STOP_VIEW_SELECT = {
  id: true,
  seq: true,
  stationId: true,
  arrivalAt: true,
  departureAt: true,
  station: { select: { nameAr: true, nameEn: true } },
} as const;

export const BOOKING_VIEW_SELECT = {
  id: true,
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
  trip: {
    select: {
      id: true,
      departureAt: true,
      company: { select: { id: true, nameAr: true, nameEn: true } },
    },
  },
  fromTripStop: { select: STOP_VIEW_SELECT },
  toTripStop: { select: STOP_VIEW_SELECT },
  passengers: {
    select: {
      id: true,
      seatId: true,
      fullName: true,
      gender: true,
      nationalIdLast4: true,
      status: true,
      tripSeat: { select: { seat: { select: { label: true, rowIndex: true, colIndex: true } } } },
    },
  },
  tickets: { select: { id: true, bookingPassengerId: true, seatLabel: true, status: true } },
} as const satisfies Prisma.BookingSelect;

export type BookingRecord = Prisma.BookingGetPayload<{ select: typeof BOOKING_VIEW_SELECT }>;

export const TICKET_VIEW_SELECT = {
  id: true,
  bookingCode: true,
  status: true,
  paymentMethod: true,
  holdExpiresAt: true,
  deadlineAt: true,
  totalAmountMinor: true,
  currency: true,
  fromSeq: true,
  toSeq: true,
  confirmedAt: true,
  cancelledAt: true,
  cancelledBy: true,
  trip: {
    select: {
      id: true,
      status: true,
      departureAt: true,
      company: { select: { id: true, nameAr: true, nameEn: true } },
    },
  },
  fromTripStop: { select: STOP_VIEW_SELECT },
  toTripStop: { select: STOP_VIEW_SELECT },
  passengers: {
    select: {
      id: true,
      fullName: true,
      status: true,
      tripSeat: { select: { seat: { select: { label: true, rowIndex: true, colIndex: true } } } },
    },
  },
  tickets: {
    select: {
      id: true,
      bookingPassengerId: true,
      seatLabel: true,
      status: true,
      version: true,
      qrTokenHash: true,
    },
  },
} as const satisfies Prisma.BookingSelect;

export type TicketRecord = Prisma.BookingGetPayload<{ select: typeof TICKET_VIEW_SELECT }> & {
  stops: Prisma.TripStopGetPayload<{ select: typeof STOP_VIEW_SELECT }>[];
};
