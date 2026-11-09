import { Injectable } from '@nestjs/common';

import { AppError } from '../../common/app-error.js';
import { Clock } from '../../common/clock.js';
import type { SeatSide, TripStatus } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { resolveSegment, type SeqRange } from '../trips/domain/segment.js';
import { BookingsRepository } from './bookings.repository.js';
import type {
  CounterQuoteInput,
  CounterSeatMapQuery,
  CreateBookingInput,
} from './bookings.schemas.js';
import {
  BookingsService,
  type CounterQuote,
  type CounterSaleOptions,
  type TicketView,
} from './bookings.service.js';
import { type CompanyBookingView, CompanyBookingsService } from './company-bookings.service.js';
import { CounterRepository } from './counter.repository.js';
import {
  computeCounterSeatMap,
  type CounterQuota,
  type CounterSeatState,
} from './domain/counter.js';
import { salesOpen } from './domain/deadlines.js';

export interface CounterStopView {
  tripStopId: string;
  seq: number;
  nameAr: string;
  nameEn: string;
  arrivalAt: string | null;
  departureAt: string | null;
}

export interface CounterSeatView {
  seatId: string;
  label: string;
  row: number;
  column: number;
  side: SeatSide;
  /** Kanal des Sitzes: online, nur Schalter oder gesperrt (ADR 0007). */
  quota: CounterQuota;
  /** Für die gewählte Teilstrecke: frei, belegt oder gesperrt. */
  state: CounterSeatState;
  /** Belegte Teilstrecken der ganzen Fahrt als Positionen der Halte, halboffen. */
  occupiedRanges: SeqRange[];
  /** Nur bei freien Sitzen und aktiver Regel: wählbar für Frau oder Mann (ADR 0006). */
  selectableFor: { FEMALE: boolean; MALE: boolean } | null;
}

/**
 * Sitzplan für das Personal am Schalter (Schritt 2.6, ADR 0030): alle Sitze mit Kontingent und
 * Belegung je Teilstrecke, ohne Namen, Kontaktdaten und Geschlecht anderer Fahrgäste.
 */
export interface CounterSeatMapView {
  trip: {
    id: string;
    status: TripStatus;
    departureAt: string;
    arrivalAt: string;
    route: { id: string; nameAr: string; nameEn: string };
    bus: { id: string; plate: string } | null;
    stops: CounterStopView[];
  };
  from: CounterStopView;
  to: CounterStopView;
  /** `null`, wenn für die Teilstrecke am Fahrtag kein Tarif gilt (Verkauf: `NO_FARE_FOR_SEGMENT`). */
  fare: { amountMinor: number; currency: string } | null;
  /** Der Schalter verkauft, solange die Fahrt geplant ist und noch nicht abgefahren. */
  salesOpen: boolean;
  genderRuleEnabled: boolean;
  nationalIdRequired: boolean;
  layout: { rows: number; columns: number };
  seats: CounterSeatView[];
  summary: { free: number; taken: number; blocked: number; counterOnly: number };
}

const iso = (value: Date | null): string | null => value?.toISOString() ?? null;

/** Lesende Transaktion mit einem Schnappschuss: alle Abfragen sehen denselben Stand. */
const SNAPSHOT = { isolationLevel: 'RepeatableRead' } as const;

/**
 * Schaltermodus (Schritt 2.6, ADR 0030): Sitzplan, Preisvorschau, Barverkauf und Ticket zum
 * Drucken. Lesen ohne Sperre; Verkauf und Storno nur über den `BookingsService` unter der
 * Trip-Sperre, dem einzigen Schreibpfad in `seat_occupation`. Die Firma kommt immer aus dem
 * geprüften Pfad (`CompanyRoleGuard`).
 *
 * Logs nennen Buchungen nur über IDs.
 */
@Injectable()
export class CounterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: CounterRepository,
    private readonly bookingsRepo: BookingsRepository,
    private readonly bookings: BookingsService,
    private readonly companyBookings: CompanyBookingsService,
    private readonly clock: Clock,
  ) {}

  async seatMap(
    companyId: string,
    tripId: string,
    query: CounterSeatMapQuery,
  ): Promise<CounterSeatMapView> {
    return this.prisma.$transaction(async (tx) => {
      const now = this.clock.now();
      const trip = await this.repo.findTrip(tx, companyId, tripId);
      if (trip === null || trip.status === 'DRAFT') {
        throw new AppError('TRIP_NOT_FOUND', { detail: 'The trip does not exist.' });
      }
      const first = trip.stops[0];
      const last = trip.stops.at(-1);
      const segment = resolveSegment(
        trip.stops,
        query.fromStopId ?? first?.id ?? '',
        query.toStopId ?? last?.id ?? '',
      );
      if (!segment.ok) {
        throw new AppError('INVALID_SEGMENT', {
          detail: 'Boarding must be an earlier stop of this trip than alighting.',
        });
      }
      const fare = await this.bookingsRepo.findFare(tx, {
        routeId: trip.routeId,
        fromRouteStopId: segment.from.routeStopId,
        toRouteStopId: segment.to.routeStopId,
        serviceDate: trip.serviceDate,
      });
      const inventory = await this.repo.inventory(tx, {
        tripId: trip.id,
        seatLayoutId: trip.seatLayoutId,
        now,
      });
      const states = computeCounterSeatMap({
        seats: inventory.seats,
        tripSeats: inventory.tripSeats,
        occupations: inventory.occupations,
        neighbors: inventory.neighbors,
        segment: segment.range,
        genderRuleEnabled: trip.genderRuleEnabled,
      });
      const stops: CounterStopView[] = trip.stops.map((stop) => ({
        tripStopId: stop.id,
        seq: stop.seq,
        nameAr: stop.station.nameAr,
        nameEn: stop.station.nameEn,
        arrivalAt: iso(stop.arrivalAt),
        departureAt: iso(stop.departureAt),
      }));
      const seats: CounterSeatView[] = inventory.seats.map((seat) => {
        const state = states.get(seat.id)!;
        return {
          seatId: seat.id,
          label: seat.label,
          row: seat.rowIndex,
          column: seat.colIndex,
          side: seat.side,
          ...state,
        };
      });
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
        from: stops.find((stop) => stop.tripStopId === segment.from.id)!,
        to: stops.find((stop) => stop.tripStopId === segment.to.id)!,
        fare,
        salesOpen:
          trip.status === 'SCHEDULED' &&
          trip.company.status === 'ACTIVE' &&
          salesOpen({
            channel: 'COUNTER',
            now,
            onlineSalesCloseAt: trip.departureAt,
            departureAt: trip.departureAt,
          }),
        genderRuleEnabled: trip.genderRuleEnabled,
        nationalIdRequired: trip.company.requireNationalId,
        layout: {
          rows: Math.max(0, ...inventory.seats.map((seat) => seat.rowIndex + 1)),
          columns: Math.max(0, ...inventory.seats.map((seat) => seat.colIndex + 1)),
        },
        seats,
        summary: {
          free: seats.filter((seat) => seat.state === 'FREE').length,
          taken: seats.filter((seat) => seat.state === 'TAKEN').length,
          blocked: seats.filter((seat) => seat.state === 'BLOCKED').length,
          counterOnly: seats.filter((seat) => seat.quota === 'COUNTER').length,
        },
      };
    }, SNAPSHOT);
  }

  quote(companyId: string, input: CounterQuoteInput): Promise<CounterQuote> {
    return this.bookings.quoteAtCounter(companyId, input);
  }

  /** Barverkauf; Antwort ist das Detail aus Sicht des Personals (Telefon maskiert). */
  async sell(
    companyId: string,
    input: CreateBookingInput,
    options: CounterSaleOptions,
  ): Promise<{ created: boolean; booking: CompanyBookingView }> {
    const result = await this.bookings.sellAtCounter(companyId, input, options);
    return {
      created: result.created,
      booking: await this.companyBookings.get(companyId, result.bookingId),
    };
  }

  ticket(companyId: string, bookingId: string): Promise<TicketView> {
    return this.bookings.ticketForCompany(companyId, bookingId);
  }
}
