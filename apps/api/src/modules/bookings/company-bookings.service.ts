import {
  type BookingChannel,
  type BookingStatus,
  type CompanyCancelReason,
  localDateInDamascus,
  maskPhone,
  type PaymentMethod,
  type PaymentState,
  type PaymentStatus,
} from '@masar/shared';
import { Injectable } from '@nestjs/common';

import { AppError } from '../../common/app-error.js';
import { Clock } from '../../common/clock.js';
import type { RequestContext } from '../../common/request-context.js';
import type {
  AuditActorType,
  CancelActor,
  Gender,
  Prisma,
  TicketStatus,
  TripStatus,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { damascusDayRange } from '../trips/domain/search-day.js';
import { BookingsRepository } from './bookings.repository.js';
import { BookingsService } from './bookings.service.js';
import type { ListBookingsQuery } from './company-bookings.schemas.js';
import {
  type BookingDetailRecord,
  type BookingListRow,
  CompanyBookingsRepository,
  type HistoryRow,
} from './company-bookings.repository.js';
import { bookingListRange, encodeBookingListCursor } from './domain/booking-list.js';
import { effectiveBookingStatus, paymentStateOf } from './domain/payment-state.js';

export interface MoneyView {
  amountMinor: number;
  currency: string;
}

export interface StaffStopView {
  tripStopId: string;
  seq: number;
  nameAr: string;
  nameEn: string;
  arrivalAt: string | null;
  departureAt: string | null;
}

/** Eintrag der Buchungsliste im Portal (Schritt 2.5, ADR 0028). Telefon nur maskiert. */
export interface BookingListItemView {
  id: string;
  /** 8 Zeichen ohne Bindestrich; die Anzeige in zwei Vierergruppen macht das Frontend. */
  bookingCode: string;
  /** Status, wie das Personal ihn sieht: nach Fristablauf `EXPIRED`, auch vor dem Ablauf-Job. */
  status: BookingStatus;
  channel: BookingChannel;
  paymentMethod: PaymentMethod | null;
  paymentState: PaymentState;
  trip: {
    id: string;
    departureAt: string;
    status: TripStatus;
    route: { id: string; nameAr: string; nameEn: string };
  };
  from: StaffStopView;
  to: StaffStopView;
  contact: { name: string; phoneMasked: string };
  passengerCount: number;
  total: MoneyView;
  holdExpiresAt: string | null;
  deadlineAt: string | null;
  createdAt: string;
}

export interface BookingHistoryEntry {
  at: string;
  /** Aktion aus dem Audit-Log, z. B. `BOOKING_CONFIRMED_CASH` oder `BOOKING_CONTACT_REVEALED`. */
  action: string;
  actorType: AuditActorType;
  /** Nur bei Personal (`USER`); Fahrgäste und System bleiben ohne ID. */
  actorUserId: string | null;
  fromStatus: BookingStatus | null;
  toStatus: BookingStatus | null;
  /** Grund als Code (Storno durch die Firma), nie Freitext. */
  reason: string | null;
}

/**
 * Buchung aus Sicht des Personals: Liste plus Fahrgäste, Tickets, Zahlungen und Verlauf. Die
 * Ausweisnummer erscheint nie, auch nicht ihre letzten Ziffern, nur `nationalIdPresent`; die
 * Telefonnummer nur maskiert. Klartext gibt es einzeln über `reveal-contact` mit Audit-Eintrag.
 */
export interface CompanyBookingView extends Omit<BookingListItemView, 'contact' | 'trip'> {
  locale: string;
  trip: BookingListItemView['trip'] & {
    arrivalAt: string;
    bus: { id: string; plate: string } | null;
  };
  fare: MoneyView;
  contact: {
    name: string;
    phoneMasked: string;
    hasEmail: boolean;
    /** Kontaktdaten nach der Löschfrist pseudonymisiert (ADR 0016). */
    purged: boolean;
  };
  passengers: {
    id: string;
    seatId: string;
    seatLabel: string;
    fullName: string;
    gender: Gender | null;
    nationalIdPresent: boolean;
    status: string;
    ticketStatus: TicketStatus | null;
  }[];
  tickets: { id: string; passengerId: string; seatLabel: string; status: TicketStatus }[];
  /** Zahlungsversuche; bis Phase 3 leer, der Stand folgt dann aus `paymentState`. */
  payments: {
    id: string;
    method: PaymentMethod;
    status: PaymentStatus;
    amount: MoneyView;
    createdAt: string;
    confirmedAt: string | null;
  }[];
  history: BookingHistoryEntry[];
  confirmedAt: string | null;
  cancelledAt: string | null;
  cancelledBy: CancelActor | null;
  cancelReason: string | null;
}

export interface BookingContactView {
  phone: string;
  email: string | null;
}

export interface TripPassengerView {
  passengerId: string;
  bookingId: string;
  seatId: string;
  seatLabel: string;
  fullName: string;
  gender: Gender | null;
  nationalIdPresent: boolean;
  bookingStatus: BookingStatus;
  channel: BookingChannel;
  paymentState: PaymentState;
  ticketStatus: TicketStatus | null;
  from: StaffStopView;
  to: StaffStopView;
}

/** Fahrgastliste einer Fahrt für Fahrer und Schalter, ohne Kontaktdaten und Buchungscodes. */
export interface TripPassengersView {
  trip: {
    id: string;
    status: TripStatus;
    departureAt: string;
    arrivalAt: string;
    route: { id: string; nameAr: string; nameEn: string };
    bus: { id: string; plate: string } | null;
    stops: StaffStopView[];
  };
  items: TripPassengerView[];
  summary: {
    passengers: number;
    paid: number;
    /** Noch nicht bezahlt (Hold, Barreservierung, in Prüfung). */
    open: number;
    perStop: { tripStopId: string; boarding: number; alighting: number }[];
  };
}

const iso = (value: Date | null): string | null => value?.toISOString() ?? null;

const BOOKING_STATUS_SET = new Set<string>([
  'HELD',
  'RESERVED',
  'PENDING_CONFIRMATION',
  'CONFIRMED',
  'CANCELLED',
  'EXPIRED',
]);

function stopFromRow(row: BookingListRow, side: 'from' | 'to'): StaffStopView {
  return side === 'from'
    ? {
        tripStopId: row.fromTripStopId,
        seq: row.fromSeq,
        nameAr: row.fromNameAr,
        nameEn: row.fromNameEn,
        arrivalAt: iso(row.fromArrivalAt),
        departureAt: iso(row.fromDepartureAt),
      }
    : {
        tripStopId: row.toTripStopId,
        seq: row.toSeq,
        nameAr: row.toNameAr,
        nameEn: row.toNameEn,
        arrivalAt: iso(row.toArrivalAt),
        departureAt: iso(row.toDepartureAt),
      };
}

function stopFromRecord(stop: BookingDetailRecord['fromTripStop']): StaffStopView {
  return {
    tripStopId: stop.id,
    seq: stop.seq,
    nameAr: stop.station.nameAr,
    nameEn: stop.station.nameEn,
    arrivalAt: iso(stop.arrivalAt),
    departureAt: iso(stop.departureAt),
  };
}

function statusOf(value: Prisma.JsonValue | undefined): BookingStatus | null {
  return typeof value === 'string' && BOOKING_STATUS_SET.has(value)
    ? (value as BookingStatus)
    : null;
}

/** Verlauf: nur Aktion, Zeit, Art der Person, Statuswechsel und Grund-Code, keine Rohdaten. */
export function toHistoryEntry(row: HistoryRow): BookingHistoryEntry {
  const data =
    typeof row.data === 'object' && row.data !== null && !Array.isArray(row.data) ? row.data : {};
  return {
    at: row.occurredAt.toISOString(),
    action: row.action,
    actorType: row.actorType,
    actorUserId: row.actorType === 'USER' ? row.actorId : null,
    fromStatus: statusOf(data['from']),
    toStatus: statusOf(data['to']),
    reason: row.reason,
  };
}

export function toListItem(row: BookingListRow): BookingListItemView {
  return {
    id: row.id,
    bookingCode: row.bookingCode,
    status: row.effectiveStatus,
    channel: row.channel,
    paymentMethod: row.paymentMethod,
    paymentState: paymentStateOf({
      status: row.effectiveStatus,
      confirmedAt: row.confirmedAt,
      payments: row.paymentStatuses,
    }),
    trip: {
      id: row.tripId,
      departureAt: row.tripDepartureAt.toISOString(),
      status: row.tripStatus,
      route: { id: row.routeId, nameAr: row.routeNameAr, nameEn: row.routeNameEn },
    },
    from: stopFromRow(row, 'from'),
    to: stopFromRow(row, 'to'),
    contact: { name: row.contactName, phoneMasked: maskPhone(row.contactPhoneE164) },
    passengerCount: row.passengerCount,
    total: { amountMinor: row.totalAmountMinor, currency: row.currency },
    holdExpiresAt: iso(row.holdExpiresAt),
    deadlineAt: iso(row.deadlineAt),
    createdAt: row.createdAt.toISOString(),
  };
}

export function toCompanyBookingView(
  record: BookingDetailRecord,
  history: HistoryRow[],
  now: Date,
): CompanyBookingView {
  const status = effectiveBookingStatus(record, now);
  const ticketByPassenger = new Map(
    record.tickets.map((ticket) => [ticket.bookingPassengerId, ticket.status]),
  );
  const passengers = [...record.passengers].sort(
    (a, b) =>
      a.tripSeat.seat.rowIndex - b.tripSeat.seat.rowIndex ||
      a.tripSeat.seat.colIndex - b.tripSeat.seat.colIndex,
  );
  const order = new Map(passengers.map((passenger, index) => [passenger.id, index]));
  return {
    id: record.id,
    bookingCode: record.bookingCode,
    status,
    channel: record.channel,
    paymentMethod: record.paymentMethod,
    paymentState: paymentStateOf({
      status,
      confirmedAt: record.confirmedAt,
      payments: record.payments.map((payment) => payment.status),
    }),
    locale: record.locale,
    trip: {
      id: record.trip.id,
      departureAt: record.trip.departureAt.toISOString(),
      arrivalAt: record.trip.arrivalAt.toISOString(),
      status: record.trip.status,
      route: record.trip.route,
      bus: record.trip.bus,
    },
    from: stopFromRecord(record.fromTripStop),
    to: stopFromRecord(record.toTripStop),
    contact: {
      name: record.contactName,
      phoneMasked: maskPhone(record.contactPhoneE164),
      hasEmail: record.contactEmail !== null,
      purged: record.piiPurgedAt !== null,
    },
    passengerCount: record.passengers.length,
    fare: { amountMinor: record.fareAmountMinor, currency: record.currency },
    total: { amountMinor: record.totalAmountMinor, currency: record.currency },
    holdExpiresAt: iso(record.holdExpiresAt),
    deadlineAt: iso(record.deadlineAt),
    createdAt: record.createdAt.toISOString(),
    passengers: passengers.map((passenger) => ({
      id: passenger.id,
      seatId: passenger.seatId,
      seatLabel: passenger.tripSeat.seat.label,
      fullName: passenger.fullName,
      gender: passenger.gender,
      nationalIdPresent: passenger.nationalIdKeyId !== null,
      status: passenger.status,
      ticketStatus: ticketByPassenger.get(passenger.id) ?? null,
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
      })),
    payments: record.payments.map((payment) => ({
      id: payment.id,
      method: payment.method,
      status: payment.status,
      amount: { amountMinor: payment.amountMinor, currency: payment.currency },
      createdAt: payment.createdAt.toISOString(),
      confirmedAt: iso(payment.confirmedAt),
    })),
    history: history.map(toHistoryEntry),
    confirmedAt: iso(record.confirmedAt),
    cancelledAt: iso(record.cancelledAt),
    cancelledBy: record.cancelledBy,
    cancelReason: record.cancelReason,
  };
}

/**
 * Buchungen im Portal (Schritt 2.5, ADR 0028): Liste, Detail, Kontakt anzeigen, Fahrgastliste und
 * die Aktionen des Personals mit dem Detail als Antwort. Lesen ohne Sperren; die Aktionen laufen
 * unverändert über den `BookingsService` unter der Trip-Sperre, der einzige Schreibpfad in
 * `seat_occupation`. Die Firma kommt immer aus dem geprüften Pfad (`CompanyRoleGuard`).
 *
 * Logs und Audit-Log nennen Buchungen und Personen nur über IDs.
 */
@Injectable()
export class CompanyBookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: CompanyBookingsRepository,
    private readonly bookingsRepo: BookingsRepository,
    private readonly bookings: BookingsService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  async list(
    companyId: string,
    query: ListBookingsQuery,
  ): Promise<{ items: BookingListItemView[]; nextCursor: string | null }> {
    if (query.q === null) {
      throw new AppError('BOOKING_SEARCH_INVALID', {
        detail: 'Search for the start of a booking code or the last digits of a phone number.',
      });
    }
    const now = this.clock.now();
    const range = bookingListRange({
      from: query.from,
      to: query.to,
      tripId: query.tripId,
      hasSearch: query.q !== undefined,
      today: localDateInDamascus(now),
    });
    const rows = await this.repo.listBookings(this.prisma, companyId, {
      ...(range.from === null ? {} : { start: damascusDayRange(range.from).start }),
      ...(range.to === null ? {} : { end: damascusDayRange(range.to).end }),
      ...(query.tripId === undefined ? {} : { tripId: query.tripId }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.paymentMethod === undefined ? {} : { paymentMethod: query.paymentMethod }),
      ...(query.channel === undefined ? {} : { channel: query.channel }),
      ...(query.q === undefined ? {} : { search: query.q }),
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      limit: query.limit + 1,
      now,
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map(toListItem),
      nextCursor:
        rows.length > query.limit && last !== undefined
          ? encodeBookingListCursor({ departureAt: last.tripDepartureAt, bookingId: last.id })
          : null,
    };
  }

  async get(companyId: string, bookingId: string): Promise<CompanyBookingView> {
    const record = await this.repo.findDetail(this.prisma, companyId, bookingId);
    if (record === null) {
      throw this.notFound();
    }
    const history = await this.repo.history(this.prisma, companyId, bookingId);
    return toCompanyBookingView(record, history, this.clock.now());
  }

  /** Buchung der eigenen Firma über den vollständigen Code; fremde Codes sind unbekannt. */
  async lookup(companyId: string, bookingCode: string): Promise<CompanyBookingView> {
    const id = await this.bookingsRepo.findIdByCode(this.prisma, companyId, bookingCode);
    if (id === null) {
      throw this.notFound();
    }
    return this.get(companyId, id);
  }

  /**
   * Telefon und E-Mail im Klartext für eine Person des Personals, mit Audit-Eintrag
   * `BOOKING_CONTACT_REVEALED` (nur IDs). Der Eintrag entsteht vor der Antwort; scheitert er,
   * gibt es keine Kontaktdaten.
   */
  async revealContact(
    companyId: string,
    bookingId: string,
    actor: AuthContext,
    context: RequestContext,
  ): Promise<BookingContactView> {
    const contact = await this.repo.contact(this.prisma, companyId, bookingId);
    if (contact === null) {
      throw this.notFound();
    }
    await this.audit.record(
      {
        action: 'BOOKING_CONTACT_REVEALED',
        actorType: 'USER',
        actorId: actor.userId,
        companyId,
        entityType: 'booking',
        entityId: bookingId,
        data: { fields: contact.contactEmail === null ? ['phone'] : ['phone', 'email'] },
      },
      context,
    );
    return { phone: contact.contactPhoneE164, email: contact.contactEmail };
  }

  async confirmCash(
    companyId: string,
    bookingId: string,
    actor: AuthContext,
    context: RequestContext,
  ): Promise<CompanyBookingView> {
    await this.bookings.confirmCash(companyId, bookingId, actor, context);
    return this.get(companyId, bookingId);
  }

  async cancel(
    companyId: string,
    bookingId: string,
    reason: CompanyCancelReason,
    actor: AuthContext,
    context: RequestContext,
  ): Promise<CompanyBookingView> {
    await this.bookings.cancelByCompany(companyId, bookingId, reason, actor, context);
    return this.get(companyId, bookingId);
  }

  /** Fahrgastliste einer Fahrt der Firma, nach Sitz; eine fremde Fahrt ist `TRIP_NOT_FOUND`. */
  async tripPassengers(companyId: string, tripId: string): Promise<TripPassengersView> {
    const trip = await this.repo.passengerTrip(this.prisma, companyId, tripId);
    if (trip === null) {
      throw new AppError('TRIP_NOT_FOUND', { detail: 'The trip does not exist.' });
    }
    const rows = await this.repo.tripPassengers(this.prisma, tripId, this.clock.now());
    const stops: StaffStopView[] = trip.stops.map((stop) => ({
      tripStopId: stop.id,
      seq: stop.seq,
      nameAr: stop.station.nameAr,
      nameEn: stop.station.nameEn,
      arrivalAt: iso(stop.arrivalAt),
      departureAt: iso(stop.departureAt),
    }));
    const stopById = new Map(stops.map((stop) => [stop.tripStopId, stop]));
    const items: TripPassengerView[] = rows.map((row) => ({
      passengerId: row.passengerId,
      bookingId: row.bookingId,
      seatId: row.seatId,
      seatLabel: row.seatLabel,
      fullName: row.fullName,
      gender: row.gender,
      nationalIdPresent: row.nationalIdPresent,
      bookingStatus: row.bookingStatus,
      channel: row.channel,
      paymentState: paymentStateOf({
        status: row.bookingStatus,
        confirmedAt: row.confirmedAt,
        payments: row.paymentStatuses,
      }),
      ticketStatus: row.ticketStatus,
      from: stopById.get(row.fromTripStopId)!,
      to: stopById.get(row.toTripStopId)!,
    }));
    const paid = items.filter((item) => item.paymentState === 'PAID').length;
    return {
      trip: {
        id: trip.id,
        status: trip.status,
        departureAt: trip.departureAt.toISOString(),
        arrivalAt: trip.arrivalAt.toISOString(),
        route: trip.route,
        bus: trip.bus,
        stops,
      },
      items,
      summary: {
        passengers: items.length,
        paid,
        open: items.length - paid,
        perStop: stops.map((stop) => ({
          tripStopId: stop.tripStopId,
          boarding: items.filter((item) => item.from.tripStopId === stop.tripStopId).length,
          alighting: items.filter((item) => item.to.tripStopId === stop.tripStopId).length,
        })),
      },
    };
  }

  private notFound(): AppError {
    return new AppError('BOOKING_NOT_FOUND', { detail: 'The booking does not exist.' });
  }
}
