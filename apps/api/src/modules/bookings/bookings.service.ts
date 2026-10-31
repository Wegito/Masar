import { createHash, randomBytes } from 'node:crypto';

import { BOOKING_LIMITS, encodeBookingCode } from '@masar/shared';
import { Injectable } from '@nestjs/common';

import { AppError } from '../../common/app-error.js';
import { Clock } from '../../common/clock.js';
import {
  databaseConstraint,
  databaseErrorCode,
  isTransactionTimeout,
} from '../../common/database-error.js';
import type { RequestContext } from '../../common/request-context.js';
import type { CancelReason, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { createToken, hashToken } from '../auth/tokens.js';
import { findFare } from '../trips/trip-read.repository.js';
import {
  addOutbox,
  countOpenBookingsForPhone,
  expireDueOnTrip,
  lockBooking,
  type LockedTrip,
  lockTrip,
  tripsWithDueBookings,
} from './booking.repository.js';
import { type BookingView, loadBookingView } from './booking-view.js';
import type { CreateBookingInput } from './bookings.schemas.js';
import { canCancel, holdExpiry, onlineBookingCutoff } from './domain/booking-state.js';
import { neighborMap } from './domain/seat-rules.js';
import { checkSeatSelection } from './domain/seat-selection.js';

/**
 * Höchstens so viele offene Buchungen (Hold, Barreservierung) je Telefonnummer, gegen das Blockieren
 * von Sitzen. Weiche Grenze: Gleichzeitige Buchungen auf verschiedenen Fahrten serialisieren nicht
 * gegeneinander und können sie um eins überschreiten. Annahme bis zur ersten Partnerfirma.
 */
export const MAX_OPEN_BOOKINGS_PER_PHONE = 3;

/** Lange genug für das Warten auf die Trip-Sperre (lock_timeout 5 s) und die Arbeit danach. */
const TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;
const BOOKING_CODE_ATTEMPTS = 3;
const EXPIRY_BATCH = 200;

type Tx = Prisma.TransactionClient;

export type CreateBookingResult =
  | { replayed: false; manageToken: string; view: BookingView }
  | { replayed: true; view: BookingView };

/** Abbildung technischer Datenbankfehler auf stabile Fehlercodes (docs/domaenenmodell.md). */
function translateDatabaseError(error: unknown): never {
  const code = databaseErrorCode(error);
  // Der EXCLUDE-Constraint greift nur, wenn ein Schreibpfad die Sperre umgangen hat.
  if (code === '23P01') {
    throw new AppError('SEAT_TAKEN', { params: { seats: [] } });
  }
  // Sperre nicht rechtzeitig bekommen oder Zeitlimit überschritten: später erneut versuchen.
  if (code === '55P03' || code === '57014' || isTransactionTimeout(error)) {
    throw new AppError('SERVICE_UNAVAILABLE', { headers: { 'Retry-After': '2' } });
  }
  throw error;
}

function fingerprint(input: CreateBookingInput): string {
  const canonical = {
    tripId: input.tripId,
    fromSeq: input.fromSeq,
    toSeq: input.toSeq,
    contact: { name: input.contact.name, phone: input.contact.phone },
    locale: input.locale,
    passengers: input.passengers.map((p) => ({
      seatId: p.seatId,
      fullName: p.fullName,
      gender: p.gender ?? null,
    })),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/**
 * Buchungskern (ADR 0005): Hold, Barreservierung, Ablauf, Storno, Bestätigung, Tickets.
 *
 * Jede Änderung folgt derselben Reihenfolge: Fahrt sperren, abgelaufene Buchungen der Fahrt
 * freigeben, frisch lesen, prüfen, schreiben. Belegungen entstehen und verschwinden nur hier, in
 * derselben Transaktion wie der Statuswechsel, mit Outbox-Eintrag und Audit.
 */
@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  private async inTransaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(work, TRANSACTION_OPTIONS);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      return translateDatabaseError(error);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Fahrgast: Hold anlegen
  // -------------------------------------------------------------------------------------------

  async create(
    input: CreateBookingInput,
    idempotencyKey: string,
    ctx: RequestContext,
  ): Promise<CreateBookingResult> {
    if (input.passengers.length > BOOKING_LIMITS.maxSeatsPerBooking) {
      throw new AppError('TOO_MANY_SEATS', { params: { max: BOOKING_LIMITS.maxSeatsPerBooking } });
    }
    const requestFingerprint = fingerprint(input);
    // Idempotenz vor der Sperre: Eine Wiederholung soll nicht auf die Fahrt warten.
    const replay = await this.replayFor(idempotencyKey, requestFingerprint);
    if (replay !== null) {
      return replay;
    }

    let created: { bookingId: string; manageToken: string } | 'replay';
    try {
      created = await this.inTransaction((tx) =>
        this.createHold(tx, input, idempotencyKey, requestFingerprint, ctx),
      );
    } catch (error) {
      // Gleichzeitige Wiederholung mit demselben Schlüssel, die die Prüfung unter der Sperre
      // knapp verpasst hat: Der Unique-Index fängt sie, die bestehende Buchung gilt.
      if (
        databaseErrorCode(error) === '23505' &&
        databaseConstraint(error) === 'booking_idempotency_key_key'
      ) {
        created = 'replay';
      } else {
        throw error;
      }
    }
    if (created === 'replay') {
      const again = await this.replayFor(idempotencyKey, requestFingerprint);
      if (again === null) {
        throw new AppError('INTERNAL_ERROR');
      }
      return again;
    }
    const { view } = await loadBookingView(this.prisma, created.bookingId);
    return { replayed: false, manageToken: created.manageToken, view };
  }

  /**
   * Antwort für eine Wiederholung. Das Verwaltungstoken kennt nur die erste Antwort, gespeichert ist
   * nur sein Hash. Wer die erste Antwort verloren hat, kommt über Buchungscode und Telefon an die
   * Buchung (Schritt 1.4).
   */
  private async replayFor(
    key: string,
    requestFingerprint: string,
  ): Promise<CreateBookingResult | null> {
    const existing = await this.prisma.booking.findUnique({
      where: { idempotencyKey: key },
      select: { id: true, requestFingerprint: true },
    });
    if (existing === null) {
      return null;
    }
    if (existing.requestFingerprint !== requestFingerprint) {
      throw new AppError('IDEMPOTENCY_KEY_REUSED');
    }
    const { view } = await loadBookingView(this.prisma, existing.id);
    return { replayed: true, view };
  }

  private async createHold(
    tx: Tx,
    input: CreateBookingInput,
    idempotencyKey: string,
    requestFingerprint: string,
    ctx: RequestContext,
  ): Promise<{ bookingId: string; manageToken: string } | 'replay'> {
    const now = this.clock.now();
    const trip = await lockTrip(tx, input.tripId);
    // Unter der Sperre erneut: Eine gleichzeitige Wiederholung kann inzwischen festgeschrieben sein.
    if (
      (await tx.booking.findUnique({ where: { idempotencyKey }, select: { id: true } })) !== null
    ) {
      return 'replay';
    }
    this.assertBookable(trip, now);
    await expireDueOnTrip(tx, trip.id, now);

    const open = await countOpenBookingsForPhone(tx, input.contact.phone, now);
    if (open >= MAX_OPEN_BOOKINGS_PER_PHONE) {
      throw new AppError('TOO_MANY_OPEN_HOLDS', { params: { max: MAX_OPEN_BOOKINGS_PER_PHONE } });
    }

    const stops = await tx.tripStop.findMany({
      where: { tripId: trip.id, seq: { in: [input.fromSeq, input.toSeq] } },
      select: { seq: true, routeStopId: true },
    });
    const from = stops.find((s) => s.seq === input.fromSeq);
    const to = stops.find((s) => s.seq === input.toSeq);
    if (from === undefined || to === undefined || input.fromSeq >= input.toSeq) {
      throw new AppError('INVALID_SEGMENT');
    }
    const fare = await findFare(tx, from.routeStopId, to.routeStopId, trip.service_date);
    if (fare === null) {
      throw new AppError('NO_FARE_FOR_SEGMENT');
    }

    const segment = { fromSeq: input.fromSeq, toSeq: input.toSeq };
    const seatIds = input.passengers.map((p) => p.seatId);
    const [tripSeats, occupations, neighbors] = await Promise.all([
      tx.tripSeat.findMany({
        where: { tripId: trip.id, seatId: { in: seatIds } },
        select: {
          seatId: true,
          onlineSellable: true,
          blocked: true,
          seat: { select: { label: true } },
        },
      }),
      tx.seatOccupation.findMany({
        where: { tripId: trip.id, fromSeq: { lt: segment.toSeq }, toSeq: { gt: segment.fromSeq } },
        select: { seatId: true, fromSeq: true, toSeq: true, bookingId: true, gender: true },
      }),
      tx.seatNeighbor.findMany({
        where: { seatId: { in: seatIds } },
        select: { seatId: true, neighborSeatId: true },
      }),
    ]);
    const problem = checkSeatSelection({
      passengers: input.passengers.map((p) => ({ seatId: p.seatId, gender: p.gender ?? null })),
      tripSeats: new Map(
        tripSeats.map((s) => [
          s.seatId,
          { label: s.seat.label, onlineSellable: s.onlineSellable, blocked: s.blocked },
        ]),
      ),
      occupations,
      neighborsOf: neighborMap(neighbors),
      segment,
      genderRuleEnabled: trip.gender_rule_enabled,
      channel: 'ONLINE',
    });
    if (problem !== null) {
      throw new AppError(problem.code, { params: { seats: problem.seats } });
    }

    const manageToken = createToken();
    const booking = await tx.booking.create({
      data: {
        companyId: trip.company_id,
        tripId: trip.id,
        bookingCode: await this.freeBookingCode(tx),
        status: 'HELD',
        channel: 'ONLINE',
        fromSeq: segment.fromSeq,
        toSeq: segment.toSeq,
        contactName: input.contact.name,
        contactPhoneE164: input.contact.phone,
        locale: input.locale,
        holdExpiresAt: holdExpiry(now, trip.hold_minutes, {
          onlineSalesCloseAt: trip.online_sales_close_at,
          cashDeadlineAt: trip.cash_deadline_at,
        }),
        fareAmountMinor: fare.amountMinor,
        totalAmountMinor: fare.amountMinor * input.passengers.length,
        currency: fare.currency,
        manageTokenHash: hashToken(manageToken),
        idempotencyKey,
        requestFingerprint,
      },
      select: { id: true, tripId: true },
    });
    const passengers = await tx.bookingPassenger.createManyAndReturn({
      data: input.passengers.map((p) => ({
        bookingId: booking.id,
        tripId: trip.id,
        seatId: p.seatId,
        fullName: p.fullName,
        gender: p.gender ?? null,
      })),
      select: { id: true, seatId: true, gender: true },
    });
    await tx.seatOccupation.createMany({
      data: passengers.map((p) => ({
        tripId: trip.id,
        seatId: p.seatId,
        fromSeq: segment.fromSeq,
        toSeq: segment.toSeq,
        bookingId: booking.id,
        bookingPassengerId: p.id,
        gender: p.gender,
      })),
    });
    await addOutbox(tx, 'BOOKING_HELD', booking, 'HELD');
    await this.audit.record(
      {
        action: 'BOOKING_HELD',
        actorType: 'GUEST',
        companyId: trip.company_id,
        entityType: 'booking',
        entityId: booking.id,
        data: { tripId: trip.id, seats: passengers.length },
      },
      ctx,
      tx,
    );
    return { bookingId: booking.id, manageToken };
  }

  private assertBookable(trip: LockedTrip | null, now: Date): asserts trip is LockedTrip {
    if (trip === null || trip.status === 'DRAFT' || trip.company_status !== 'ACTIVE') {
      throw new AppError('TRIP_NOT_FOUND');
    }
    if (trip.status !== 'SCHEDULED') {
      throw new AppError('TRIP_NOT_BOOKABLE');
    }
    const cutoff = onlineBookingCutoff({
      onlineSalesCloseAt: trip.online_sales_close_at,
      cashDeadlineAt: trip.cash_deadline_at,
    });
    if (now >= cutoff) {
      throw new AppError('SALES_CLOSED');
    }
  }

  /** Zufälliger Code; bei einer (sehr seltenen) Kollision neu würfeln, höchstens dreimal. */
  private async freeBookingCode(tx: Tx): Promise<string> {
    for (let attempt = 0; attempt < BOOKING_CODE_ATTEMPTS; attempt++) {
      const code = encodeBookingCode(randomBytes(5));
      if (
        (await tx.booking.findUnique({ where: { bookingCode: code }, select: { id: true } })) ===
        null
      ) {
        return code;
      }
    }
    throw new AppError('SERVICE_UNAVAILABLE', { headers: { 'Retry-After': '1' } });
  }

  // -------------------------------------------------------------------------------------------
  // Fahrgast: Ansicht, Barzahlung, Storno (über das Verwaltungstoken)
  // -------------------------------------------------------------------------------------------

  /** Unbekanntes und falsches Token ergeben dieselbe Antwort (ADR 0009). */
  private async bookingForToken(
    token: string | undefined,
  ): Promise<{ id: string; tripId: string }> {
    const booking =
      token === undefined
        ? null
        : await this.prisma.booking.findUnique({
            where: { manageTokenHash: hashToken(token) },
            select: { id: true, tripId: true },
          });
    if (booking === null) {
      throw new AppError('BOOKING_NOT_FOUND');
    }
    return booking;
  }

  async viewByToken(token: string | undefined): Promise<BookingView> {
    const booking = await this.bookingForToken(token);
    return (await loadBookingView(this.prisma, booking.id)).view;
  }

  /** HELD → RESERVED mit Frist für die Barzahlung. Eine Wiederholung ändert nichts. */
  async reserveCash(token: string | undefined, ctx: RequestContext): Promise<BookingView> {
    const booking = await this.bookingForToken(token);
    await this.inTransaction(async (tx) => {
      const { current, trip } = await this.lockForChange(tx, booking);
      if (current.status === 'RESERVED') {
        return;
      }
      if (current.status === 'EXPIRED') {
        throw new AppError('HOLD_EXPIRED');
      }
      if (current.status !== 'HELD') {
        throw new AppError('INVALID_STATE_TRANSITION');
      }
      // Der Hold endet spätestens zur Barfrist (holdExpiry); ein lebender Hold liegt also davor.
      await tx.booking.update({
        where: { id: current.id },
        data: {
          status: 'RESERVED',
          paymentMethod: 'CASH',
          deadlineAt: trip.cash_deadline_at,
          version: { increment: 1 },
        },
      });
      await addOutbox(tx, 'BOOKING_RESERVED', current, 'RESERVED');
      await this.audit.record(
        {
          action: 'BOOKING_CASH_RESERVED',
          actorType: 'GUEST',
          companyId: current.companyId,
          entityType: 'booking',
          entityId: current.id,
        },
        ctx,
        tx,
      );
    });
    return (await loadBookingView(this.prisma, booking.id)).view;
  }

  /** Storno durch den Fahrgast: nur ohne geflossenes Geld (HELD, RESERVED). */
  async cancelByPassenger(token: string | undefined, ctx: RequestContext): Promise<BookingView> {
    const booking = await this.bookingForToken(token);
    await this.inTransaction(async (tx) => {
      const { current } = await this.lockForChange(tx, booking);
      if (current.status === 'CANCELLED' || current.status === 'EXPIRED') {
        return;
      }
      if (!canCancel(current.status, 'PASSENGER')) {
        throw new AppError('BOOKING_NOT_CANCELLABLE');
      }
      await this.cancel(tx, current, 'PASSENGER', 'PASSENGER_REQUEST');
      await this.audit.record(
        {
          action: 'BOOKING_CANCELLED',
          actorType: 'GUEST',
          companyId: current.companyId,
          entityType: 'booking',
          entityId: current.id,
          reason: 'PASSENGER_REQUEST',
        },
        ctx,
        tx,
      );
    });
    return (await loadBookingView(this.prisma, booking.id)).view;
  }

  // -------------------------------------------------------------------------------------------
  // Personal der Firma: Suche nach Code, Barzahlung bestätigen, Storno
  // -------------------------------------------------------------------------------------------

  /** `companyId` ist durch den Guard gegen die Mitgliedschaft geprüft; fremde Buchungen: 404. */
  async findForCompany(companyId: string, bookingCode: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { bookingCode, companyId },
      select: { id: true },
    });
    if (booking === null) {
      throw new AppError('BOOKING_NOT_FOUND');
    }
    return this.staffView(booking.id);
  }

  private async staffView(bookingId: string) {
    const { bookingId: id, view } = await loadBookingView(this.prisma, bookingId);
    return { bookingId: id, ...view };
  }

  private async companyBooking(companyId: string, bookingId: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, companyId },
      select: { id: true, tripId: true },
    });
    if (booking === null) {
      throw new AppError('BOOKING_NOT_FOUND');
    }
    return booking;
  }

  /** RESERVED → CONFIRMED: Zahlung bar erhalten. Erzeugt Zahlung und Tickets je Fahrgast. */
  async confirmCash(companyId: string, bookingId: string, auth: AuthContext, ctx: RequestContext) {
    const booking = await this.companyBooking(companyId, bookingId);
    await this.inTransaction(async (tx) => {
      const { current } = await this.lockForChange(tx, booking);
      if (current.status === 'CONFIRMED') {
        return;
      }
      if (current.status === 'EXPIRED') {
        throw new AppError('HOLD_EXPIRED');
      }
      if (current.status !== 'RESERVED') {
        throw new AppError('INVALID_STATE_TRANSITION');
      }
      const now = this.clock.now();
      await tx.booking.update({
        where: { id: current.id },
        data: { status: 'CONFIRMED', confirmedAt: now, version: { increment: 1 } },
      });
      await tx.payment.create({
        data: {
          bookingId: current.id,
          companyId: current.companyId,
          provider: 'CASH',
          status: 'SUCCEEDED',
          amountMinor: current.totalAmountMinor,
          currency: current.currency,
          confirmedByUserId: auth.userId,
          confirmedAt: now,
        },
      });
      const passengers = await tx.bookingPassenger.findMany({
        where: { bookingId: current.id },
        select: { id: true, tripSeat: { select: { seat: { select: { label: true } } } } },
      });
      await tx.ticket.createMany({
        data: passengers.map((p) => ({
          bookingPassengerId: p.id,
          bookingId: current.id,
          tripId: current.tripId,
          companyId: current.companyId,
          seatLabel: p.tripSeat.seat.label,
        })),
      });
      await addOutbox(tx, 'BOOKING_CONFIRMED', current, 'CONFIRMED');
      await this.audit.record(
        {
          action: 'BOOKING_CONFIRMED',
          actorType: 'USER',
          actorId: auth.userId,
          companyId: current.companyId,
          entityType: 'booking',
          entityId: current.id,
          data: { paymentProvider: 'CASH', tickets: passengers.length },
        },
        ctx,
        tx,
      );
    });
    return this.staffView(booking.id);
  }

  /**
   * Storno durch die Firma, auch für bestätigte Buchungen. Tickets werden ungültig. Eine bereits
   * bar erhaltene Zahlung erstattet die Firma vor Ort; Erstattungen als Datensatz folgen in Phase 3.
   */
  async cancelByCompany(
    companyId: string,
    bookingId: string,
    reason: CancelReason,
    auth: AuthContext,
    ctx: RequestContext,
  ) {
    const booking = await this.companyBooking(companyId, bookingId);
    await this.inTransaction(async (tx) => {
      const { current } = await this.lockForChange(tx, booking);
      if (current.status === 'CANCELLED' || current.status === 'EXPIRED') {
        return;
      }
      if (!canCancel(current.status, 'COMPANY')) {
        throw new AppError('BOOKING_NOT_CANCELLABLE');
      }
      await this.cancel(tx, current, 'COMPANY', reason);
      await this.audit.record(
        {
          action: 'BOOKING_CANCELLED',
          actorType: 'USER',
          actorId: auth.userId,
          companyId: current.companyId,
          entityType: 'booking',
          entityId: current.id,
          reason,
          data: { previousStatus: current.status },
        },
        ctx,
        tx,
      );
    });
    return this.staffView(booking.id);
  }

  // -------------------------------------------------------------------------------------------
  // Gemeinsame Bausteine
  // -------------------------------------------------------------------------------------------

  /**
   * Sperrt Fahrt und Buchung (in dieser Reihenfolge), gibt abgelaufene Buchungen der Fahrt frei und
   * liest die Buchung danach frisch. Eine eben abgelaufene Buchung erscheint dadurch als EXPIRED.
   */
  private async lockForChange(tx: Tx, booking: { id: string; tripId: string }) {
    const now = this.clock.now();
    const trip = await lockTrip(tx, booking.tripId);
    if (trip === null) {
      throw new AppError('BOOKING_NOT_FOUND');
    }
    await lockBooking(tx, booking.id);
    await expireDueOnTrip(tx, booking.tripId, now);
    const current = await tx.booking.findUniqueOrThrow({
      where: { id: booking.id },
      select: {
        id: true,
        tripId: true,
        companyId: true,
        status: true,
        totalAmountMinor: true,
        currency: true,
      },
    });
    return { current, trip };
  }

  /** Statuswechsel nach CANCELLED: Belegung löschen, Tickets ungültig, Outbox. */
  private async cancel(
    tx: Tx,
    booking: { id: string; tripId: string },
    actor: 'PASSENGER' | 'COMPANY',
    reason: CancelReason,
  ): Promise<void> {
    await tx.booking.update({
      where: { id: booking.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: this.clock.now(),
        cancelledBy: actor,
        cancelReason: reason,
        version: { increment: 1 },
      },
    });
    await tx.seatOccupation.deleteMany({ where: { bookingId: booking.id } });
    await tx.ticket.updateMany({
      where: { bookingId: booking.id, status: 'ISSUED' },
      data: { status: 'VOID' },
    });
    await addOutbox(tx, 'BOOKING_CANCELLED', booking, 'CANCELLED');
  }

  /**
   * Ablauf-Job: gibt fällige Holds und Barreservierungen frei, je Fahrt in einer eigenen
   * Transaktion unter deren Sperre. Liefert die Zahl abgelaufener Buchungen.
   */
  async expireDue(): Promise<number> {
    const now = this.clock.now();
    const tripIds = await tripsWithDueBookings(this.prisma, now, EXPIRY_BATCH);
    let expired = 0;
    for (const tripId of tripIds) {
      expired += await this.inTransaction(async (tx) => {
        await lockTrip(tx, tripId);
        return (await expireDueOnTrip(tx, tripId, now)).length;
      });
    }
    return expired;
  }
}
