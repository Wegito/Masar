import type { BookingChannel, CompanyCancelReason } from '@masar/shared';
import { Injectable, Logger } from '@nestjs/common';

import { AppError } from '../../common/app-error.js';
import { Clock } from '../../common/clock.js';
import type { RequestContext } from '../../common/request-context.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { type BookingEventType, OutboxService } from '../outbox/outbox.service.js';
import { resolveSegment, type SegmentResolution } from '../trips/domain/segment.js';
import {
  type BookingRecord,
  BookingsRepository,
  type LockedBooking,
  type LockedTrip,
  type TicketRecord,
} from './bookings.repository.js';
import type { CounterQuoteInput, CreateBookingInput } from './bookings.schemas.js';
import { mapCriticalError, sqlState } from './db-errors.js';
import { decideCancellation } from './domain/cancellation.js';
import { cashDeadlineAt, holdExpiresAt, salesOpen } from './domain/deadlines.js';
import { nationalIdLast4 } from './domain/national-id.js';
import { basisPointsOf, priceBooking } from './domain/pricing.js';
import {
  checkGenderRule,
  checkSeatSelection,
  MAX_SEATS_PER_BOOKING,
} from './domain/seat-selection.js';
import {
  generateBookingCode,
  hashSecret,
  issueManageToken,
  MANAGE_TOKEN_LENGTH,
  type RandomSource,
  secretMatches,
} from './domain/secrets.js';
import { isSameBookingRequest } from './domain/idempotency.js';
import { bookingTransition } from './domain/transitions.js';
import { GuestKeys } from './guest-keys.js';
import { LookupLimiter } from './lookup-limiter.js';
import { NationalIdCipher } from './national-id.cipher.js';

type Tx = Prisma.TransactionClient;

/**
 * Offene, unbestätigte Buchungen je Telefonnummer über alle Fahrten. Begrenzt das Blockieren von
 * Sitzen mit erfundenen Reservierungen (ADR 0008, Gegenmittel „Limits je Telefonnummer"). Hin- und
 * Rückfahrt plus eine Reserve passen hinein.
 */
export const MAX_OPEN_BOOKINGS_PER_PHONE = 3;

/**
 * Grund in `booking.cancel_reason`, wenn die Firma die ganze Fahrt absagt (Schritt 2.4). Kein Wert
 * aus `COMPANY_CANCEL_REASONS`, weil das Personal ihn beim Einzelstorno nicht wählen kann.
 */
export const TRIP_CANCELLED_REASON = 'TRIP_CANCELLED';

/** Versuche, einen freien Buchungscode zu würfeln (ADR 0013). */
const BOOKING_CODE_ATTEMPTS = 3;

/** Platzhalter für die Pseudonymisierung von Name und Telefon nach der Abfahrt (ADR 0016). */
const PII_RETENTION_DAYS = 365;

/**
 * Wartezeiten der kritischen Transaktion. `lock_timeout` (5 s) und `statement_timeout` (10 s) der
 * Verbindung greifen zuerst; das Transaktionsfenster fängt nur, was dazwischen hängt.
 */
const CRITICAL_TX = { maxWait: 5_000, timeout: 15_000 } as const;

/**
 * Laufzeit des Lesetokens nach Code und Telefon (ADR 0022). Kurz, weil Code und Telefon ein
 * schwacher Nachweis sind; lang genug für einen Reisetag. Die Ticketseite bleibt danach als
 * gespeicherte Kopie lesbar und fragt Code und Telefon erneut ab.
 */
export const ACCESS_TOKEN_TTL_MS = 12 * 3_600_000;

/** Was ein Token erlaubt: Lesen (Verwaltungs- oder Lesetoken) oder Ändern (nur Verwaltungstoken). */
type GuestScope = 'read' | 'manage';

export interface MoneyView {
  amountMinor: number;
  currency: string;
}

export interface BookingStopView {
  tripStopId: string;
  stationId: string;
  nameAr: string;
  nameEn: string;
  arrivalAt: string | null;
  departureAt: string | null;
}

export interface BookingView {
  id: string;
  /** 8 Zeichen ohne Bindestrich; die Anzeige in zwei Vierergruppen macht das Frontend. */
  bookingCode: string;
  status: BookingRecord['status'];
  channel: BookingRecord['channel'];
  paymentMethod: BookingRecord['paymentMethod'];
  locale: BookingRecord['locale'];
  trip: {
    id: string;
    departureAt: string;
    company: { id: string; nameAr: string; nameEn: string };
  };
  from: BookingStopView;
  to: BookingStopView;
  holdExpiresAt: string | null;
  deadlineAt: string | null;
  fare: MoneyView;
  total: MoneyView;
  contact: { name: string; phone: string; email: string | null };
  passengers: {
    id: string;
    seatId: string;
    seatLabel: string;
    fullName: string;
    gender: BookingRecord['passengers'][number]['gender'];
    nationalIdLast4: string | null;
    status: BookingRecord['passengers'][number]['status'];
  }[];
  /** Ohne QR-Token: Es steht nur als Hash in der Datenbank (ADR 0020). */
  tickets: { id: string; passengerId: string; seatLabel: string; status: string }[];
  createdAt: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
  cancelledBy: BookingRecord['cancelledBy'];
}

/**
 * Ticketseite (Schritt 1.4, ADR 0022): nur, was Fahrgast und Fahrer brauchen. Ohne Kontaktdaten,
 * Geschlecht und Ausweisnummer, weil auch Code und Telefon (schwacher Nachweis) diese Sicht
 * öffnen. Der Name steht drin, weil das Personal ihn beim Einsteigen mit dem Ausweis vergleicht.
 */
export interface TicketView {
  id: string;
  bookingCode: string;
  status: TicketRecord['status'];
  paymentMethod: TicketRecord['paymentMethod'];
  holdExpiresAt: string | null;
  deadlineAt: string | null;
  total: MoneyView;
  trip: {
    id: string;
    status: TicketRecord['trip']['status'];
    departureAt: string;
    company: { id: string; nameAr: string; nameEn: string };
  };
  from: BookingStopView;
  to: BookingStopView;
  /** Alle Halte vom Einstieg bis zum Ausstieg, in Fahrtrichtung. */
  stops: BookingStopView[];
  passengers: {
    id: string;
    seatLabel: string;
    fullName: string;
    status: TicketRecord['passengers'][number]['status'];
  }[];
  /** `qrToken` nur bei bestätigter Buchung und ausgestelltem Ticket; nie gespeichert oder geloggt. */
  tickets: {
    id: string;
    passengerId: string;
    seatLabel: string;
    status: TicketRecord['tickets'][number]['status'];
    qrToken: string | null;
  }[];
  confirmedAt: string | null;
  cancelledAt: string | null;
  cancelledBy: TicketRecord['cancelledBy'];
}

export interface LookupResult {
  /** Lesetoken für `X-Manage-Token`; nur diese Buchung, nur lesen, kurzlebig. */
  accessToken: string;
  accessExpiresAt: string;
  booking: TicketView;
}

export interface HoldResult {
  /** `false`, wenn der `Idempotency-Key` schon zu dieser Buchung gehörte (Wiederholung). */
  created: boolean;
  booking: BookingView;
  /** Geht nur in dieser Antwort hinaus; gespeichert ist der SHA-256-Hash. */
  manageToken: string;
}

export interface HoldOptions {
  channel: BookingChannel;
  idempotencyKey: string | null;
  context: RequestContext;
}

export interface CounterSaleOptions {
  idempotencyKey: string;
  actor: AuthContext;
  context: RequestContext;
}

export interface CounterSaleResult {
  /** `false`, wenn der `Idempotency-Key` schon zu diesem Verkauf gehörte (Wiederholung). */
  created: boolean;
  bookingId: string;
}

/** Preisvorschau des Schalters: Tarif der Teilstrecke × Fahrgäste, ohne zu schreiben. */
export interface CounterQuote {
  tripId: string;
  fromStopId: string;
  toStopId: string;
  seats: { seatId: string; label: string }[];
  fare: MoneyView;
  total: MoneyView;
}

type Outcome = { ok: true } | { ok: false; error: AppError };

type PassengerInput = CreateBookingInput['passengers'][number];

type ResolvedSegment = Extract<
  SegmentResolution<{ id: string; seq: number; routeStopId: string }>,
  { ok: true }
>;

const iso = (value: Date | null): string | null => value?.toISOString() ?? null;

function stopView(stop: BookingRecord['fromTripStop']): BookingStopView {
  return {
    tripStopId: stop.id,
    stationId: stop.stationId,
    nameAr: stop.station.nameAr,
    nameEn: stop.station.nameEn,
    arrivalAt: iso(stop.arrivalAt),
    departureAt: iso(stop.departureAt),
  };
}

export function toBookingView(record: BookingRecord): BookingView {
  const passengers = [...record.passengers].sort(
    (a, b) =>
      a.tripSeat.seat.rowIndex - b.tripSeat.seat.rowIndex ||
      a.tripSeat.seat.colIndex - b.tripSeat.seat.colIndex,
  );
  return {
    id: record.id,
    bookingCode: record.bookingCode,
    status: record.status,
    channel: record.channel,
    paymentMethod: record.paymentMethod,
    locale: record.locale,
    trip: {
      id: record.trip.id,
      departureAt: record.trip.departureAt.toISOString(),
      company: record.trip.company,
    },
    from: stopView(record.fromTripStop),
    to: stopView(record.toTripStop),
    holdExpiresAt: iso(record.holdExpiresAt),
    deadlineAt: iso(record.deadlineAt),
    fare: { amountMinor: record.fareAmountMinor, currency: record.currency },
    total: { amountMinor: record.totalAmountMinor, currency: record.currency },
    contact: {
      name: record.contactName,
      phone: record.contactPhoneE164,
      email: record.contactEmail,
    },
    passengers: passengers.map((passenger) => ({
      id: passenger.id,
      seatId: passenger.seatId,
      seatLabel: passenger.tripSeat.seat.label,
      fullName: passenger.fullName,
      gender: passenger.gender,
      nationalIdLast4: passenger.nationalIdLast4,
      status: passenger.status,
    })),
    tickets: [...record.tickets]
      .sort((a, b) => a.seatLabel.localeCompare(b.seatLabel))
      .map((ticket) => ({
        id: ticket.id,
        passengerId: ticket.bookingPassengerId,
        seatLabel: ticket.seatLabel,
        status: ticket.status,
      })),
    createdAt: record.createdAt.toISOString(),
    confirmedAt: iso(record.confirmedAt),
    cancelledAt: iso(record.cancelledAt),
    cancelledBy: record.cancelledBy,
  };
}

function bySeatPosition(
  a: { tripSeat: { seat: { rowIndex: number; colIndex: number } } },
  b: { tripSeat: { seat: { rowIndex: number; colIndex: number } } },
): number {
  return (
    a.tripSeat.seat.rowIndex - b.tripSeat.seat.rowIndex ||
    a.tripSeat.seat.colIndex - b.tripSeat.seat.colIndex
  );
}

/** Ticketseite aus dem Datensatz; `qrTokens` je Ticket-ID nur für zeigbare Tickets. */
export function toTicketView(
  record: TicketRecord,
  qrTokens: ReadonlyMap<string, string>,
): TicketView {
  const passengers = [...record.passengers].sort(bySeatPosition);
  const order = new Map(passengers.map((passenger, index) => [passenger.id, index]));
  return {
    id: record.id,
    bookingCode: record.bookingCode,
    status: record.status,
    paymentMethod: record.paymentMethod,
    holdExpiresAt: iso(record.holdExpiresAt),
    deadlineAt: iso(record.deadlineAt),
    total: { amountMinor: record.totalAmountMinor, currency: record.currency },
    trip: {
      id: record.trip.id,
      status: record.trip.status,
      departureAt: record.trip.departureAt.toISOString(),
      company: record.trip.company,
    },
    from: stopView(record.fromTripStop),
    to: stopView(record.toTripStop),
    stops: record.stops.map(stopView),
    passengers: passengers.map((passenger) => ({
      id: passenger.id,
      seatLabel: passenger.tripSeat.seat.label,
      fullName: passenger.fullName,
      status: passenger.status,
    })),
    tickets: [...record.tickets]
      .sort(
        (a, b) => (order.get(a.bookingPassengerId) ?? 0) - (order.get(b.bookingPassengerId) ?? 0),
      )
      .map((ticket) => ({
        id: ticket.id,
        passengerId: ticket.bookingPassengerId,
        seatLabel: ticket.seatLabel,
        status: ticket.status,
        qrToken: qrTokens.get(ticket.id) ?? null,
      })),
    confirmedAt: iso(record.confirmedAt),
    cancelledAt: iso(record.cancelledAt),
    cancelledBy: record.cancelledBy,
  };
}

/**
 * Buchungskern (Schritt 1.3, docs/domaenenmodell.md „Kritische Transaktion"). Jede Methode, die
 * Status oder Belegung ändert, folgt demselben Muster: Trip-Zeile sperren → abgelaufene Buchungen
 * der Fahrt freigeben → Buchung sperren → frisch lesen → prüfen → schreiben, mit Audit-Eintrag und
 * Outbox-Ereignis in derselben Transaktion. Sperr-Reihenfolge immer Trip → Booking (→ Payment ab
 * Phase 3).
 *
 * Logs nennen Buchungen nur über ihre ID; nie Code, Name, Telefon oder Token.
 */
@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);
  /** Austauschbar nur für Tests, die Kollisionen des Buchungscodes erzwingen. */
  random: RandomSource | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bookings: BookingsRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly cipher: NationalIdCipher,
    private readonly keys: GuestKeys,
    private readonly limiter: LookupLimiter,
    private readonly clock: Clock,
  ) {}

  // --- Reservieren ----------------------------------------------------------------------------

  async hold(input: CreateBookingInput, options: HoldOptions): Promise<HoldResult> {
    if (input.passengers.length > MAX_SEATS_PER_BOOKING) {
      throw new AppError('TOO_MANY_SEATS', {
        detail: 'Too many seats in one booking.',
        params: { max: MAX_SEATS_PER_BOOKING },
      });
    }
    const key = options.idempotencyKey;
    // 1. Idempotenz vor der Sperre: Eine Wiederholung wartet nicht auf die Fahrt.
    if (key !== null) {
      const existing = await this.bookings.findByIdempotencyKey(this.prisma, key);
      if (existing !== null) {
        return this.replay(existing, input);
      }
    }

    let outcome: { replay: true } | { replay: false; bookingId: string; manageToken: string };
    try {
      outcome = await this.critical(async (tx) => {
        const now = this.clock.now();
        // 2. Sperren und Verkaufsfenster prüfen.
        const trip = await this.lockBookableTrip(tx, input.tripId, options.channel, now);
        // Eine gleichzeitige Anfrage mit demselben Schlüssel kann inzwischen fertig sein.
        if (key !== null && (await this.bookings.findByIdempotencyKey(tx, key)) !== null) {
          return { replay: true as const };
        }
        // 3. Abgelaufene Buchungen der Fahrt freigeben.
        await this.releaseExpired(tx, trip.id, now);

        // 4. Frisch lesen: Teilstrecke, Tarif, Sitze mit Kontingent, Belegungen.
        const { segment, fare } = await this.segmentAndFare(tx, trip, input);
        this.checkPassengerData(trip, input);
        const open = await this.bookings.countOpenBookingsForPhone(tx, input.contact.phone, now);
        if (open >= MAX_OPEN_BOOKINGS_PER_PHONE) {
          throw new AppError('TOO_MANY_OPEN_HOLDS', {
            detail: 'Too many open reservations for this phone number.',
            params: { max: MAX_OPEN_BOOKINGS_PER_PHONE },
          });
        }

        // 5. Prüfen: Kontingent, Überlappung, Geschlechtsregel.
        await this.checkSeats(tx, trip, segment.range, input.passengers, options.channel, true);

        // 6. Schreiben: Buchung, Fahrgäste, Belegungen, Audit, Outbox.
        const price = priceBooking(fare, input.passengers.length);
        const manage = issueManageToken();
        const bookingId = await this.insertWithFreshCode(tx, {
          companyId: trip.companyId,
          tripId: trip.id,
          channel: options.channel,
          status: 'HELD',
          fromTripStopId: segment.from.id,
          toTripStopId: segment.to.id,
          ...segment.range,
          contactName: input.contact.name,
          contactPhoneE164: input.contact.phone,
          contactEmail: input.contact.email ?? null,
          locale: input.locale,
          holdExpiresAt: holdExpiresAt(now, trip.holdMinutes, trip.departureAt),
          paymentMethod: null,
          confirmedAt: null,
          commissionRateBps: null,
          commissionAmountMinor: null,
          ...price,
          manageTokenHash: manage.hash,
          idempotencyKey: key,
          piiPurgeAfter: this.piiPurgeAfter(trip),
          now,
        });
        await this.insertPassengersAndOccupy(tx, trip, bookingId, input.passengers, now);
        await this.recordEvent(tx, {
          type: 'BOOKING_HELD',
          action: 'BOOKING_HELD',
          booking: { id: bookingId, companyId: trip.companyId },
          previousStatus: null,
          status: 'HELD',
          actor: { actorType: 'GUEST', actorId: null },
          context: options.context,
          data: { tripId: trip.id, seats: input.passengers.length, channel: options.channel },
          now,
        });
        return { replay: false as const, bookingId, manageToken: manage.token };
      });
    } catch (error) {
      // 7. Kollision des Idempotenz-Schlüssels: Die andere Anfrage hat gewonnen.
      if (key !== null && sqlState(error) === '23505') {
        const existing = await this.bookings.findByIdempotencyKey(this.prisma, key);
        if (existing !== null) {
          return this.replay(existing, input);
        }
      }
      throw error;
    }
    if (outcome.replay) {
      const existing = await this.bookings.findByIdempotencyKey(this.prisma, key!);
      return this.replay(existing!, input);
    }
    return {
      created: true,
      booking: await this.view(outcome.bookingId),
      manageToken: outcome.manageToken,
    };
  }

  /** Barzahlung gewählt: `HELD` → `RESERVED` mit der Barfrist der Fahrt. */
  async reserveCash(
    bookingId: string,
    manageToken: string,
    context: RequestContext,
  ): Promise<BookingView> {
    const access = await this.guestAccess(bookingId, manageToken, 'manage');
    const outcome = await this.critical(async (tx): Promise<Outcome> => {
      const now = this.clock.now();
      const { trip, booking } = await this.lockTripAndBooking(tx, access.tripId, bookingId, now);
      if (booking.status === 'EXPIRED') {
        return { ok: false, error: this.holdExpired() };
      }
      const step = bookingTransition(booking.status, 'RESERVED');
      if (step === 'NOOP') {
        return { ok: true };
      }
      if (step === 'REJECT') {
        throw this.invalidTransition();
      }
      if (trip.status !== 'SCHEDULED') {
        throw new AppError('TRIP_NOT_BOOKABLE', { detail: 'The trip is not on sale.' });
      }
      const deadlineAt = cashDeadlineAt({
        tripCashDeadlineAt: trip.cashDeadlineAt,
        departureAt: trip.departureAt,
        cashDeadlineMinutes: trip.cashDeadlineMinutes,
      });
      if (deadlineAt.getTime() <= now.getTime()) {
        throw new AppError('CASH_DEADLINE_PASSED', {
          detail: 'Cash reservations for this trip have closed.',
        });
      }
      await this.bookings.markReservedCash(tx, { bookingId, deadlineAt, now });
      await this.recordEvent(tx, {
        type: 'BOOKING_RESERVED',
        action: 'BOOKING_RESERVED_CASH',
        booking,
        previousStatus: booking.status,
        status: 'RESERVED',
        actor: { actorType: 'GUEST', actorId: null },
        context,
        data: { paymentMethod: 'CASH' },
        now,
      });
      return { ok: true };
    });
    return this.finish(outcome, bookingId);
  }

  async cancelByPassenger(
    bookingId: string,
    manageToken: string,
    context: RequestContext,
  ): Promise<BookingView> {
    const access = await this.guestAccess(bookingId, manageToken, 'manage');
    await this.cancel(access.tripId, bookingId, {
      actor: 'PASSENGER',
      actorUserId: null,
      reason: null,
      context,
    });
    return this.view(bookingId);
  }

  /** Lesen mit Verwaltungs- oder Lesetoken. */
  async getForGuest(bookingId: string, token: string): Promise<BookingView> {
    await this.guestAccess(bookingId, token, 'read');
    return this.view(bookingId);
  }

  // --- Ticketseite (Schritt 1.4, ADR 0022) ----------------------------------------------------

  /**
   * Buchung über Code und Telefon finden (ADR 0009). Unbekannter Code und falsches Telefon ergeben
   * dieselbe 404 nach derselben Arbeit: eine Abfrage über den eindeutigen Code, ein Vergleich in
   * konstanter Zeit. Begrenzt je Code (hier) und je IP (Controller). Antwort mit Lesetoken.
   */
  async lookupForGuest(bookingCode: string, phoneE164: string): Promise<LookupResult> {
    const now = this.clock.now();
    const decision = this.limiter.hit(bookingCode, now.getTime());
    if (!decision.allowed) {
      throw new AppError('RATE_LIMITED', {
        detail: 'Too many lookups for this booking code.',
        headers: { 'Retry-After': String(decision.retryAfterSeconds) },
      });
    }
    const found = await this.bookings.findByCode(this.prisma, bookingCode);
    // Der Vergleich läuft auch ohne Treffer (gegen einen leeren Wert), damit beide Wege gleich sind.
    const phoneOk = secretMatches(phoneE164, hashSecret(found?.contactPhoneE164 ?? ''));
    if (found === null || !phoneOk) {
      throw this.notFound();
    }
    const expiresAt = new Date(now.getTime() + ACCESS_TOKEN_TTL_MS);
    return {
      accessToken: this.keys.signAccess(found.id, expiresAt),
      accessExpiresAt: expiresAt.toISOString(),
      booking: await this.ticketView(found.id),
    };
  }

  /** Ticketseite mit Verwaltungs- oder Lesetoken, samt QR-Tokens. */
  async ticketForGuest(bookingId: string, token: string): Promise<TicketView> {
    await this.guestAccess(bookingId, token, 'read');
    return this.ticketView(bookingId);
  }

  // --- Personal der Firma ---------------------------------------------------------------------
  // Suche, Liste und Detail für das Personal liegen im CompanyBookingsService (Schritt 2.5); hier
  // bleiben nur die Schreibpfade unter der Trip-Sperre.

  /**
   * „Bar bezahlt": `RESERVED` → `CONFIRMED`. In derselben Transaktion entstehen die Tickets, und
   * der Provisionssatz wird eingefroren (ADR 0017).
   */
  async confirmCash(
    companyId: string,
    bookingId: string,
    actor: AuthContext,
    context: RequestContext,
  ): Promise<BookingView> {
    const access = await this.companyAccess(companyId, bookingId);
    const outcome = await this.critical(async (tx): Promise<Outcome> => {
      const now = this.clock.now();
      const { trip, booking } = await this.lockTripAndBooking(tx, access.tripId, bookingId, now);
      if (booking.status === 'EXPIRED') {
        return { ok: false, error: this.holdExpired() };
      }
      const step = bookingTransition(booking.status, 'CONFIRMED');
      if (step === 'NOOP') {
        return { ok: true };
      }
      // Bar bestätigt das Personal nur Barreservierungen; Holds und Wallet-Zahlungen haben eigene Wege.
      if (step === 'REJECT' || booking.status !== 'RESERVED') {
        throw this.invalidTransition();
      }
      if (trip.status !== 'SCHEDULED' && trip.status !== 'DEPARTED') {
        throw new AppError('TRIP_NOT_BOOKABLE', { detail: 'The trip is not running.' });
      }

      const tickets = await this.issueTickets(tx, trip, bookingId, now);
      const commission = await this.commissionFor(tx, trip, booking.totalAmountMinor);
      if (commission.missing) {
        this.logger.warn(
          { bookingId, companyId: trip.companyId },
          'Kein gültiger Provisionssatz, Buchung mit 0 bps eingefroren',
        );
      }
      await this.bookings.markConfirmed(tx, {
        bookingId,
        commissionRateBps: commission.rateBps,
        commissionAmountMinor: commission.amountMinor,
        now,
      });
      await this.recordEvent(tx, {
        type: 'BOOKING_CONFIRMED',
        action: 'BOOKING_CONFIRMED_CASH',
        booking,
        previousStatus: booking.status,
        status: 'CONFIRMED',
        actor: { actorType: 'USER', actorId: actor.userId },
        context,
        data: {
          paymentMethod: 'CASH',
          tickets,
          commissionRateBps: commission.rateBps,
          commissionRateMissing: commission.missing,
        },
        now,
      });
      return { ok: true };
    });
    return this.finish(outcome, bookingId);
  }

  async cancelByCompany(
    companyId: string,
    bookingId: string,
    reason: CompanyCancelReason,
    actor: AuthContext,
    context: RequestContext,
  ): Promise<BookingView> {
    const access = await this.companyAccess(companyId, bookingId);
    await this.cancel(access.tripId, bookingId, {
      actor: 'COMPANY',
      actorUserId: actor.userId,
      reason,
      context,
    });
    return this.view(bookingId);
  }

  /** Ticketseite mit QR-Tokens für das Personal der Firma (Druckansicht am Schalter). */
  async ticketForCompany(companyId: string, bookingId: string): Promise<TicketView> {
    await this.companyAccess(companyId, bookingId);
    return this.ticketView(bookingId);
  }

  // --- Schalter (Schritt 2.6, ADR 0030) ------------------------------------------------------

  /**
   * Barverkauf am Schalter in einer Transaktion: Trip sperren → abgelaufene freigeben → frisch
   * lesen → prüfen (dieselben Segment-, Kontingent- und Geschlechtsregeln wie online, aber Kanal
   * `COUNTER`: auch Schalter-Sitze, Verkauf bis zur Abfahrt, ohne Grenze offener Buchungen je
   * Telefon) → Buchung direkt `CONFIRMED` mit `confirmed_at`, Fahrgäste, Belegungen, Tickets,
   * Provision, Audit, Outbox. Ohne Hold und ohne Verwaltungstoken.
   *
   * Der `Idempotency-Key` schützt vor doppelter Absendung: Dieselbe Anfrage ergibt dieselbe
   * Buchung (`created: false`), eine andere mit demselben Schlüssel `IDEMPOTENCY_KEY_REUSED`.
   */
  async sellAtCounter(
    companyId: string,
    input: CreateBookingInput,
    options: CounterSaleOptions,
  ): Promise<CounterSaleResult> {
    if (input.passengers.length > MAX_SEATS_PER_BOOKING) {
      throw new AppError('TOO_MANY_SEATS', {
        detail: 'Too many seats in one booking.',
        params: { max: MAX_SEATS_PER_BOOKING },
      });
    }
    const key = options.idempotencyKey;
    const replay = async (): Promise<CounterSaleResult | null> => {
      const existing = await this.bookings.findByIdempotencyKey(this.prisma, key);
      if (existing === null) {
        return null;
      }
      if (!isSameBookingRequest(existing, this.requestOf(input, 'COUNTER', companyId))) {
        throw this.keyReused();
      }
      return { created: false, bookingId: existing.id };
    };
    const earlier = await replay();
    if (earlier !== null) {
      return earlier;
    }

    let outcome: { replay: true } | { replay: false; bookingId: string };
    try {
      outcome = await this.critical(async (tx) => {
        const now = this.clock.now();
        const trip = await this.lockBookableTrip(tx, input.tripId, 'COUNTER', now, companyId);
        if ((await this.bookings.findByIdempotencyKey(tx, key)) !== null) {
          return { replay: true as const };
        }
        await this.releaseExpired(tx, trip.id, now);

        const { segment, fare } = await this.segmentAndFare(tx, trip, input);
        this.checkPassengerData(trip, input);
        await this.checkSeats(tx, trip, segment.range, input.passengers, 'COUNTER', true);

        const price = priceBooking(fare, input.passengers.length);
        const commission = await this.commissionFor(tx, trip, price.totalAmountMinor);
        const bookingId = await this.insertWithFreshCode(tx, {
          companyId: trip.companyId,
          tripId: trip.id,
          channel: 'COUNTER',
          status: 'CONFIRMED',
          fromTripStopId: segment.from.id,
          toTripStopId: segment.to.id,
          ...segment.range,
          contactName: input.contact.name,
          contactPhoneE164: input.contact.phone,
          contactEmail: input.contact.email ?? null,
          locale: input.locale,
          holdExpiresAt: null,
          paymentMethod: 'CASH',
          confirmedAt: now,
          commissionRateBps: commission.rateBps,
          commissionAmountMinor: commission.amountMinor,
          ...price,
          manageTokenHash: null,
          idempotencyKey: key,
          piiPurgeAfter: this.piiPurgeAfter(trip),
          now,
        });
        await this.insertPassengersAndOccupy(tx, trip, bookingId, input.passengers, now);
        const tickets = await this.issueTickets(tx, trip, bookingId, now);
        if (commission.missing) {
          this.logger.warn(
            { bookingId, companyId: trip.companyId },
            'Kein gültiger Provisionssatz, Schalterverkauf mit 0 bps eingefroren',
          );
        }
        await this.recordEvent(tx, {
          type: 'BOOKING_CONFIRMED',
          action: 'BOOKING_SOLD_AT_COUNTER',
          booking: { id: bookingId, companyId: trip.companyId },
          previousStatus: null,
          status: 'CONFIRMED',
          actor: { actorType: 'USER', actorId: options.actor.userId },
          context: options.context,
          data: {
            tripId: trip.id,
            seats: input.passengers.length,
            channel: 'COUNTER',
            paymentMethod: 'CASH',
            tickets,
            commissionRateBps: commission.rateBps,
            commissionRateMissing: commission.missing,
          },
          now,
        });
        return { replay: false as const, bookingId };
      });
    } catch (error) {
      // Kollision des Idempotenz-Schlüssels: Die andere Anfrage hat gewonnen.
      if (sqlState(error) === '23505') {
        const winner = await replay();
        if (winner !== null) {
          return winner;
        }
      }
      throw error;
    }
    if (outcome.replay) {
      return (await replay())!;
    }
    return { created: true, bookingId: outcome.bookingId };
  }

  /**
   * Preisvorschau am Schalter ohne Sperre und ohne Schreiben: Teilstrecke, Tarif und Sitze mit
   * denselben Regeln wie der Verkauf. Ein Schnappschuss; verbindlich prüft erst der Verkauf. Die
   * Geschlechtsregel prüft die Vorschau nur, wenn jeder Sitz ein Geschlecht trägt.
   */
  async quoteAtCounter(companyId: string, input: CounterQuoteInput): Promise<CounterQuote> {
    if (input.seats.length > MAX_SEATS_PER_BOOKING) {
      throw new AppError('TOO_MANY_SEATS', {
        detail: 'Too many seats in one booking.',
        params: { max: MAX_SEATS_PER_BOOKING },
      });
    }
    return this.prisma.$transaction(
      async (tx) => {
        const now = this.clock.now();
        const trip = this.checkBookableTrip(
          await this.bookings.findTrip(tx, input.tripId),
          'COUNTER',
          now,
          companyId,
        );
        const { segment, fare } = await this.segmentAndFare(tx, trip, input);
        const withGender = input.seats.every((seat) => seat.gender !== undefined);
        const labels = await this.checkSeats(
          tx,
          trip,
          segment.range,
          input.seats,
          'COUNTER',
          withGender,
          now,
        );
        const price = priceBooking(fare, input.seats.length);
        return {
          tripId: trip.id,
          fromStopId: segment.from.id,
          toStopId: segment.to.id,
          seats: input.seats.map((seat) => ({
            seatId: seat.seatId,
            label: labels.get(seat.seatId) ?? seat.seatId,
          })),
          fare: { amountMinor: price.fareAmountMinor, currency: price.currency },
          total: { amountMinor: price.totalAmountMinor, currency: price.currency },
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  // --- Fahrtplanung (Schritt 2.4) ------------------------------------------------------------

  /**
   * Sperrt eine Fahrt der Firma in der Transaktion des Aufrufers und gibt danach abgelaufene
   * Buchungen frei. Erster Schritt jedes Schreibpfads der Fahrtplanung, der Kontingent oder
   * Buchungen berührt (Sperr-Reihenfolge Trip → Booking → Payment). Eine Fahrt einer anderen Firma
   * ist `null`, wie eine unbekannte.
   */
  async lockTripForPlanning(
    tx: Tx,
    companyId: string,
    tripId: string,
    now: Date,
  ): Promise<LockedTrip | null> {
    const trip = await this.bookings.lockTrip(tx, tripId);
    if (trip === null || trip.companyId !== companyId) {
      return null;
    }
    await this.releaseExpired(tx, trip.id, now);
    return trip;
  }

  /**
   * Storniert alle aktiven Buchungen einer abgesagten Fahrt: Belegungen löschen, Tickets `VOID`,
   * Fahrgäste `CANCELLED`, je Buchung Audit und Outbox (Storno-E-Mail). Ohne Gebühr, weil die Firma
   * absagt. Nur nach {@link lockTripForPlanning} in derselben Transaktion aufrufen. Erstattungen
   * entstehen erst mit den Zahlungen (Phase 3); bis dahin gibt es keine `payment`-Zeilen.
   */
  async cancelBookingsOfCancelledTrip(
    tx: Tx,
    input: { tripId: string; actorUserId: string; context: RequestContext; now: Date },
  ): Promise<{ bookings: number; seatsFreed: number; ticketsVoided: number }> {
    const active = await this.bookings.lockActiveBookings(tx, input.tripId);
    let seatsFreed = 0;
    let ticketsVoided = 0;
    for (const booking of active) {
      const freed = await this.bookings.cancel(tx, {
        bookingId: booking.id,
        actor: 'COMPANY',
        actorUserId: input.actorUserId,
        reason: TRIP_CANCELLED_REASON,
        now: input.now,
      });
      seatsFreed += freed.seatsFreed;
      ticketsVoided += freed.ticketsVoided;
      await this.recordEvent(tx, {
        type: 'BOOKING_CANCELLED',
        action: 'BOOKING_CANCELLED_BY_COMPANY',
        booking,
        previousStatus: booking.status,
        status: 'CANCELLED',
        actor: { actorType: 'USER', actorId: input.actorUserId },
        context: input.context,
        reason: TRIP_CANCELLED_REASON,
        data: { ...freed, tripId: input.tripId, feeBps: 0, feeAmountMinor: 0 },
        now: input.now,
      });
    }
    return { bookings: active.length, seatsFreed, ticketsVoided };
  }

  // --- Ablauf ---------------------------------------------------------------------------------

  /**
   * Gibt abgelaufene Buchungen einer Fahrt frei (für den Job). Ist die Fahrt gerade gesperrt,
   * übernimmt die laufende Buchung das Freigeben (`SKIP LOCKED`); der Job versucht es beim
   * nächsten Durchgang wieder.
   */
  async expireTrip(tripId: string): Promise<number> {
    return this.critical(async (tx) => {
      const trip = await this.bookings.lockTrip(tx, tripId, { skipLocked: true });
      if (trip === null) {
        return 0;
      }
      return (await this.releaseExpired(tx, trip.id, this.clock.now())).length;
    });
  }

  async tripsWithExpiredBookings(limit: number): Promise<string[]> {
    return this.bookings.tripsWithExpiredBookings(this.prisma, this.clock.now(), limit);
  }

  // --- Bausteine ------------------------------------------------------------------------------

  private async cancel(
    tripId: string,
    bookingId: string,
    input: {
      actor: 'PASSENGER' | 'COMPANY';
      actorUserId: string | null;
      reason: CompanyCancelReason | null;
      context: RequestContext;
    },
  ): Promise<void> {
    const outcome = await this.critical(async (tx): Promise<Outcome> => {
      const now = this.clock.now();
      const { trip, booking } = await this.lockTripAndBooking(tx, tripId, bookingId, now);
      const policy = await this.bookings.cancellationPolicy(tx, trip.id);
      const decision = decideCancellation({
        actor: input.actor,
        status: booking.status,
        now,
        departureAt: trip.departureAt,
        anyCheckedIn: await this.bookings.anyTicketCheckedIn(tx, bookingId),
        allowPassengerCancel: policy.allowPassengerCancel,
        rules: policy.rules,
      });
      if (decision.kind === 'NOOP') {
        return { ok: true };
      }
      if (decision.kind === 'REJECTED') {
        return {
          ok: false,
          error:
            booking.status === 'EXPIRED'
              ? this.holdExpired()
              : decision.code === 'INVALID_STATE_TRANSITION'
                ? this.invalidTransition()
                : new AppError('BOOKING_NOT_CANCELLABLE', {
                    detail: 'The booking can no longer be cancelled.',
                  }),
        };
      }
      const freed = await this.bookings.cancel(tx, {
        bookingId,
        actor: input.actor,
        actorUserId: input.actorUserId,
        reason: input.reason,
        now,
      });
      // Erstattungen entstehen erst mit Zahlungen (Phase 3); die Gebühr steht im Audit-Log.
      const feeAmountMinor =
        booking.status === 'CONFIRMED'
          ? basisPointsOf(booking.totalAmountMinor, decision.feeBps)
          : 0;
      await this.recordEvent(tx, {
        type: 'BOOKING_CANCELLED',
        action:
          input.actor === 'PASSENGER'
            ? 'BOOKING_CANCELLED_BY_PASSENGER'
            : 'BOOKING_CANCELLED_BY_COMPANY',
        booking,
        previousStatus: booking.status,
        status: 'CANCELLED',
        actor:
          input.actor === 'PASSENGER'
            ? { actorType: 'GUEST', actorId: null }
            : { actorType: 'USER', actorId: input.actorUserId },
        context: input.context,
        reason: input.reason,
        data: { ...freed, feeBps: decision.feeBps, feeAmountMinor },
        now,
      });
      return { ok: true };
    });
    if (!outcome.ok) {
      throw outcome.error;
    }
  }

  /**
   * Kritische Transaktion mit Fehlerabbildung (Domänenmodell, Schritt 7). Read Committed; die
   * Trip-Zeile ist der Serialisierungspunkt.
   */
  private async critical<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(work, CRITICAL_TX);
    } catch (error) {
      throw mapCriticalError(error);
    }
  }

  /** Fehler, die erst nach dem Commit geworfen werden, damit freigegebene Holds bestehen bleiben. */
  private async finish(outcome: Outcome, bookingId: string): Promise<BookingView> {
    if (!outcome.ok) {
      throw outcome.error;
    }
    return this.view(bookingId);
  }

  private async lockBookableTrip(
    tx: Tx,
    tripId: string,
    channel: BookingChannel,
    now: Date,
    companyId: string | null = null,
  ): Promise<LockedTrip> {
    return this.checkBookableTrip(
      await this.bookings.lockTrip(tx, tripId),
      channel,
      now,
      companyId,
    );
  }

  /**
   * Ist die Fahrt im Verkauf für diesen Kanal? Mit `companyId` (Schalter) ist eine Fahrt einer
   * anderen Firma unbekannt, wie ein Entwurf oder eine Fahrt einer gesperrten Firma.
   */
  private checkBookableTrip(
    trip: LockedTrip | null,
    channel: BookingChannel,
    now: Date,
    companyId: string | null,
  ): LockedTrip {
    // Entwürfe und Fahrten gesperrter Firmen sind nach außen unbekannt (wie im Sitzplan).
    if (
      trip === null ||
      trip.status === 'DRAFT' ||
      trip.companyStatus !== 'ACTIVE' ||
      (companyId !== null && trip.companyId !== companyId)
    ) {
      throw new AppError('TRIP_NOT_FOUND', { detail: 'The trip does not exist.' });
    }
    if (trip.status !== 'SCHEDULED') {
      throw new AppError('TRIP_NOT_BOOKABLE', { detail: 'The trip is not on sale.' });
    }
    if (
      !salesOpen({
        channel,
        now,
        onlineSalesCloseAt: trip.onlineSalesCloseAt,
        departureAt: trip.departureAt,
      })
    ) {
      throw new AppError('SALES_CLOSED', { detail: 'Sales for this trip have ended.' });
    }
    return trip;
  }

  /** Trip → abgelaufene freigeben → Booking: dieselbe Reihenfolge in jedem Pfad. */
  private async lockTripAndBooking(
    tx: Tx,
    tripId: string,
    bookingId: string,
    now: Date,
  ): Promise<{ trip: LockedTrip; booking: LockedBooking }> {
    const trip = await this.bookings.lockTrip(tx, tripId);
    if (trip === null) {
      throw this.notFound();
    }
    await this.releaseExpired(tx, trip.id, now);
    const booking = await this.bookings.lockBooking(tx, bookingId);
    if (booking === null || booking.tripId !== trip.id) {
      throw this.notFound();
    }
    return { trip, booking };
  }

  private async releaseExpired(tx: Tx, tripId: string, now: Date): Promise<string[]> {
    const expired = await this.bookings.releaseExpired(tx, tripId, now);
    for (const booking of expired) {
      await this.recordEvent(tx, {
        type: 'BOOKING_EXPIRED',
        action: 'BOOKING_EXPIRED',
        booking,
        previousStatus: booking.previousStatus,
        status: 'EXPIRED',
        actor: { actorType: 'SYSTEM', actorId: null },
        context: {},
        data: { tripId },
        now,
      });
    }
    if (expired.length > 0) {
      this.logger.log({ tripId, count: expired.length }, 'Abgelaufene Buchungen freigegeben');
    }
    return expired.map((booking) => booking.id);
  }

  private async recordEvent(
    tx: Tx,
    event: {
      type: BookingEventType;
      action: string;
      booking: { id: string; companyId: string };
      previousStatus: LockedBooking['status'] | null;
      status: LockedBooking['status'];
      actor: { actorType: 'USER' | 'GUEST' | 'SYSTEM'; actorId: string | null };
      context: RequestContext;
      reason?: string | null;
      data: Prisma.InputJsonObject;
      now: Date;
    },
  ): Promise<void> {
    await this.audit.record(
      {
        action: event.action,
        ...event.actor,
        companyId: event.booking.companyId,
        entityType: 'booking',
        entityId: event.booking.id,
        reason: event.reason ?? null,
        data: { ...event.data, from: event.previousStatus, to: event.status },
      },
      event.context,
      tx,
    );
    await this.outbox.enqueueBookingEvent(
      tx,
      event.type,
      { bookingId: event.booking.id, status: event.status, previousStatus: event.previousStatus },
      event.now,
    );
  }

  /** Teilstrecke aus den Halten der Fahrt und der gültige Tarif dafür am Fahrtag (ADR 0026). */
  private async segmentAndFare(
    tx: Tx,
    trip: LockedTrip,
    input: { fromStopId: string; toStopId: string },
  ): Promise<{
    segment: ResolvedSegment;
    fare: { amountMinor: number; currency: string };
  }> {
    const segment = resolveSegment(
      await this.bookings.findStops(tx, trip.id),
      input.fromStopId,
      input.toStopId,
    );
    if (!segment.ok) {
      throw new AppError('INVALID_SEGMENT', {
        detail: 'Boarding must be an earlier stop of this trip than alighting.',
      });
    }
    const fare = await this.bookings.findFare(tx, {
      routeId: trip.routeId,
      fromRouteStopId: segment.from.routeStopId,
      toRouteStopId: segment.to.routeStopId,
      serviceDate: trip.serviceDate,
    });
    if (fare === null) {
      throw new AppError('NO_FARE_FOR_SEGMENT', {
        detail: 'There is no valid fare for this pair of stops.',
      });
    }
    return { segment, fare };
  }

  /**
   * Kontingent, Überlappung und Geschlechtsregel für die gewählten Sitze (ADR 0005, 0006, 0007).
   * Ohne `activeAt` liest die Prüfung alle Belegungen; das ist richtig unter der Trip-Sperre,
   * nachdem abgelaufene Buchungen freigegeben sind. Die Vorschau ohne Sperre gibt `activeAt` mit
   * und übersieht so Belegungen abgelaufener, noch nicht freigegebener Buchungen. Liefert die
   * Beschriftungen der Sitze.
   */
  private async checkSeats(
    tx: Tx,
    trip: LockedTrip,
    range: { fromSeq: number; toSeq: number },
    passengers: readonly { seatId: string; gender?: PassengerInput['gender'] }[],
    channel: BookingChannel,
    withGender: boolean,
    activeAt?: Date,
  ): Promise<Map<string, string>> {
    const seatIds = passengers.map((passenger) => passenger.seatId);
    const seats = await this.bookings.findSeats(tx, {
      tripId: trip.id,
      seatLayoutId: trip.seatLayoutId,
      seatIds,
    });
    const occupations = await this.bookings.findOverlappingOccupations(tx, {
      tripId: trip.id,
      ...range,
      ...(activeAt === undefined ? {} : { activeAt }),
    });
    const labels = new Map(seats.seats.map((seat) => [seat.id, seat.label]));
    const seatCheck = checkSeatSelection({
      channel,
      requestedSeatIds: seatIds,
      layoutSeats: seats.seats,
      tripSeats: seats.tripSeats,
      occupations,
      segment: range,
    });
    if (!seatCheck.ok) {
      throw this.seatError(seatCheck.code, seatCheck.seatIds, labels);
    }
    if (!withGender) {
      return labels;
    }
    const genderCheck = checkGenderRule({
      enabled: trip.genderRuleEnabled,
      passengers: passengers.map((passenger) => ({
        seatId: passenger.seatId,
        gender: passenger.gender ?? null,
      })),
      occupations,
      neighbors: seats.neighbors,
      segment: range,
    });
    if (!genderCheck.ok) {
      throw genderCheck.code === 'GENDER_REQUIRED'
        ? new AppError('GENDER_REQUIRED', {
            detail: 'This trip requires a gender per passenger.',
          })
        : this.seatError('GENDER_RULE_CONFLICT', genderCheck.seatIds, labels);
    }
    return labels;
  }

  /**
   * Fahrgäste anlegen (Ausweisnummer nur verschlüsselt und nur, wenn die Firma sie verlangt,
   * ADR 0016) und ihre Sitze belegen. Einziger Schreibpfad in `seat_occupation` neben dem Löschen.
   */
  private async insertPassengersAndOccupy(
    tx: Tx,
    trip: LockedTrip,
    bookingId: string,
    passengers: readonly PassengerInput[],
    now: Date,
  ): Promise<void> {
    const piiPurgeAfter = this.piiPurgeAfter(trip);
    const passengerIds = await this.bookings.newIds(tx, passengers.length);
    for (const [index, passenger] of passengers.entries()) {
      const id = passengerIds[index]!;
      const nationalId =
        trip.requireNationalId && passenger.nationalId !== undefined
          ? {
              ...this.cipher.encrypt(passenger.nationalId, id),
              last4: nationalIdLast4(passenger.nationalId),
            }
          : null;
      await this.bookings.insertPassenger(tx, {
        id,
        bookingId,
        tripId: trip.id,
        seatId: passenger.seatId,
        fullName: passenger.fullName,
        gender: passenger.gender ?? null,
        nationalIdEncrypted: nationalId?.ciphertext ?? null,
        nationalIdKeyId: nationalId?.keyId ?? null,
        nationalIdLast4: nationalId?.last4 ?? null,
        piiPurgeAfter,
        now,
      });
    }
    const occupied = await this.bookings.occupySeats(tx, bookingId, now);
    if (occupied !== passengers.length) {
      throw new Error('Belegung unvollständig geschrieben');
    }
  }

  /** Ein Ticket je aktivem Fahrgast; gespeichert wird nur der Hash des QR-Tokens (ADR 0022). */
  private async issueTickets(
    tx: Tx,
    trip: LockedTrip,
    bookingId: string,
    now: Date,
  ): Promise<number> {
    const passengers = await this.bookings.activePassengersWithSeats(tx, bookingId);
    const ticketIds = await this.bookings.newIds(tx, passengers.length);
    for (const [index, passenger] of passengers.entries()) {
      const id = ticketIds[index]!;
      await this.bookings.insertTicket(tx, {
        id,
        passengerId: passenger.id,
        bookingId,
        tripId: trip.id,
        companyId: trip.companyId,
        seatLabel: passenger.seatLabel,
        qrTokenHash: this.keys.ticketTokenHash(id, 0),
        now,
      });
    }
    return passengers.length;
  }

  /** Provisionssatz am Fahrtag, eingefroren bei der Bestätigung (ADR 0017); fehlt er, 0 bps. */
  private async commissionFor(
    tx: Tx,
    trip: LockedTrip,
    totalAmountMinor: number,
  ): Promise<{ rateBps: number; amountMinor: number; missing: boolean }> {
    const rateBps = await this.bookings.findCommissionRateBps(tx, trip.companyId, trip.serviceDate);
    const effective = rateBps ?? 0;
    return {
      rateBps: effective,
      amountMinor: basisPointsOf(totalAmountMinor, effective),
      missing: rateBps === null,
    };
  }

  private piiPurgeAfter(trip: LockedTrip): Date {
    return new Date(trip.departureAt.getTime() + PII_RETENTION_DAYS * 24 * 3_600_000);
  }

  private requestOf(
    input: {
      tripId: string;
      fromStopId: string;
      toStopId: string;
      passengers: { seatId: string }[];
    },
    channel: BookingChannel,
    companyId: string | null,
  ): Parameters<typeof isSameBookingRequest>[1] {
    return {
      companyId,
      channel,
      tripId: input.tripId,
      fromStopId: input.fromStopId,
      toStopId: input.toStopId,
      seatIds: input.passengers.map((passenger) => passenger.seatId),
    };
  }

  private keyReused(): AppError {
    return new AppError('IDEMPOTENCY_KEY_REUSED', {
      detail: 'The Idempotency-Key belongs to a different booking request.',
    });
  }

  private async insertWithFreshCode(
    tx: Tx,
    input: Omit<Parameters<BookingsRepository['insertBooking']>[1], 'bookingCode'>,
  ): Promise<string> {
    for (let attempt = 1; attempt <= BOOKING_CODE_ATTEMPTS; attempt++) {
      const id = await this.bookings.insertBooking(tx, {
        ...input,
        bookingCode: generateBookingCode(this.random),
      });
      if (id !== null) {
        return id;
      }
      this.logger.warn({ attempt }, 'Buchungscode kollidiert, neu gewürfelt');
    }
    throw new Error('Kein freier Buchungscode nach drei Versuchen');
  }

  private checkPassengerData(trip: LockedTrip, input: CreateBookingInput): void {
    if (!trip.requireNationalId) {
      return;
    }
    if (!this.cipher.available) {
      // Ohne Schlüssel keine Ausweisnummer im Klartext speichern: lieber keine Buchung.
      this.logger.error({ companyId: trip.companyId }, 'NATIONAL_ID_KEYS fehlt, Buchung abgelehnt');
      throw new AppError('SERVICE_UNAVAILABLE', {
        detail: 'Bookings for this company are temporarily unavailable.',
        headers: { 'Retry-After': '60' },
      });
    }
    if (input.passengers.some((passenger) => passenger.nationalId === undefined)) {
      throw new AppError('NATIONAL_ID_REQUIRED', {
        detail: 'This company requires a national ID per passenger.',
      });
    }
  }

  private seatError(
    code:
      'SEAT_UNKNOWN' | 'SEAT_BLOCKED' | 'SEAT_NOT_ONLINE' | 'SEAT_TAKEN' | 'GENDER_RULE_CONFLICT',
    seatIds: string[],
    labels: ReadonlyMap<string, string>,
  ): AppError {
    const details = {
      SEAT_UNKNOWN: 'A seat does not belong to the seat layout of this trip.',
      SEAT_BLOCKED: 'A seat is blocked by the company.',
      SEAT_NOT_ONLINE: 'A seat is not part of the online quota.',
      SEAT_TAKEN: 'One or more seats are already taken on an overlapping segment.',
      GENDER_RULE_CONFLICT: 'A seat is not selectable for this passenger.',
    } as const;
    // Unbekannte Sitze haben keine Beschriftung; dann nennt die Antwort die IDs aus der Anfrage.
    const params =
      code === 'SEAT_UNKNOWN' ? { seatIds } : { seats: seatIds.map((id) => labels.get(id) ?? id) };
    return new AppError(code, { detail: details[code], params });
  }

  private async replay(
    existing: NonNullable<Awaited<ReturnType<BookingsRepository['findByIdempotencyKey']>>>,
    input: CreateBookingInput,
  ): Promise<HoldResult> {
    // Auch der Kanal zählt: Ein Schlüssel einer Schalterbuchung gibt online kein Token aus.
    if (!isSameBookingRequest(existing, this.requestOf(input, 'ONLINE', null))) {
      throw this.keyReused();
    }
    // Das alte Token ist nur als Hash bekannt. Die Wiederholung bekommt ein neues; das alte wird
    // damit ungültig (ADR 0020).
    const manage = issueManageToken();
    await this.bookings.setManageTokenHash(this.prisma, existing.id, manage.hash, this.clock.now());
    return { created: false, booking: await this.view(existing.id), manageToken: manage.token };
  }

  /**
   * Prüft ein Token aus `X-Manage-Token`. Verwaltungstokens (22 Zeichen) erlauben alles,
   * Lesetokens aus Code und Telefon nur `read` (ADR 0022). Unbekannte ID, falsches, abgelaufenes
   * oder für diesen Zweck nicht ausreichendes Token ergeben dieselbe Antwort (ADR 0009).
   */
  private async guestAccess(
    bookingId: string,
    token: string,
    scope: GuestScope,
  ): Promise<{ tripId: string; companyId: string }> {
    const access = await this.bookings.findAccess(this.prisma, bookingId);
    if (access === null) {
      throw this.notFound();
    }
    const allowed =
      token.length === MANAGE_TOKEN_LENGTH
        ? secretMatches(token, access.manageTokenHash)
        : scope === 'read' && this.keys.verifyAccess(bookingId, token, this.clock.now());
    if (!allowed) {
      throw this.notFound();
    }
    return access;
  }

  /**
   * Ticketseite: QR-Tokens nur für bestätigte Buchungen und ausgestellte Tickets. Passt der
   * gespeicherte Hash nicht zur Ableitung (Ticket vor ADR 0022, neuer Schlüssel), wird er ersetzt;
   * damit gilt ab jetzt der gezeigte QR-Code, ein älterer nicht mehr.
   */
  private async ticketView(bookingId: string): Promise<TicketView> {
    const record = await this.bookings.findTicketView(this.prisma, bookingId);
    if (record === null) {
      throw this.notFound();
    }
    const qrTokens = new Map<string, string>();
    if (record.status === 'CONFIRMED') {
      const now = this.clock.now();
      for (const ticket of record.tickets) {
        if (ticket.status !== 'ISSUED') {
          continue;
        }
        const token = this.keys.ticketToken(ticket.id, ticket.version);
        const hash = hashSecret(token);
        if (hash !== ticket.qrTokenHash) {
          await this.bookings.rekeyTicket(this.prisma, ticket.id, hash, now);
          this.logger.log({ bookingId, ticketId: ticket.id }, 'QR-Hash eines Tickets ersetzt');
        }
        qrTokens.set(ticket.id, token);
      }
    }
    return toTicketView(record, qrTokens);
  }

  private async companyAccess(
    companyId: string,
    bookingId: string,
  ): Promise<{ tripId: string; companyId: string }> {
    const access = await this.bookings.findAccess(this.prisma, bookingId);
    // Eine Buchung einer anderen Firma ist für diese Firma unbekannt, nicht verboten.
    if (access === null || access.companyId !== companyId) {
      throw this.notFound();
    }
    return access;
  }

  private async view(bookingId: string): Promise<BookingView> {
    const record = await this.bookings.findView(this.prisma, bookingId);
    if (record === null) {
      throw this.notFound();
    }
    return toBookingView(record);
  }

  private notFound(): AppError {
    return new AppError('BOOKING_NOT_FOUND', { detail: 'The booking does not exist.' });
  }

  private holdExpired(): AppError {
    return new AppError('HOLD_EXPIRED', { detail: 'The reservation has expired.' });
  }

  private invalidTransition(): AppError {
    return new AppError('INVALID_STATE_TRANSITION', {
      detail: 'The action does not fit the current booking status.',
    });
  }
}
