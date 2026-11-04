import type { SeatState } from '@masar/shared';
import { Injectable } from '@nestjs/common';

import { AppError } from '../../common/app-error.js';
import { Clock } from '../../common/clock.js';
import type { SeatSide } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { capFreeSeats, type FreeSeatsDisplay } from './domain/availability.js';
import { damascusDayRange } from './domain/search-day.js';
import { encodeSearchCursor } from './domain/search-cursor.js';
import { computeSeatStates } from './domain/seat-map.js';
import { resolveSegment } from './domain/segment.js';
import type { SeatMapQuery, TripSearchQuery } from './trips.schemas.js';
import { type StopRow, TripsRepository } from './trips.repository.js';

/** Betrag in Minor-Units mit ISO-4217-Code (ADR 0011), wie in der Datenbank gespeichert. */
export interface MoneyView {
  amountMinor: number;
  currency: string;
}

export interface CompanySummary {
  id: string;
  nameAr: string;
  nameEn: string;
}

/** Halt einer Fahrt. Zeitpunkte in UTC; die Ortszeit rechnet das Frontend (ADR 0012). */
export interface StopView {
  tripStopId: string;
  stationId: string;
  cityId: string;
  nameAr: string;
  nameEn: string;
  arrivalAt: string | null;
  departureAt: string | null;
}

export interface TripSearchItem {
  tripId: string;
  company: CompanySummary;
  /** Abfahrt am Einstiegshalt. */
  departureAt: string;
  /** Ankunft am Ausstiegshalt; `null`, wenn die Fahrt dort keine Zeit pflegt. */
  arrivalAt: string | null;
  from: StopView;
  to: StopView;
  /** Halte der Teilstrecke vom Einstieg bis zum Ausstieg, beide eingeschlossen. */
  stops: StopView[];
  fare: MoneyView;
  freeSeats: FreeSeatsDisplay;
  genderRuleEnabled: boolean;
}

export interface TripSearchResult {
  items: TripSearchItem[];
  nextCursor: string | null;
}

export interface SeatView {
  seatId: string;
  label: string;
  row: number;
  column: number;
  side: SeatSide;
  state: SeatState;
}

export interface SeatMapResult {
  tripId: string;
  company: CompanySummary;
  from: StopView;
  to: StopView;
  fare: MoneyView;
  genderRule: {
    /** Die Fahrt nutzt die Geschlechtsregel (ADR 0006). */
    enabled: boolean;
    /** Die Regel ist in `state` eingerechnet; ohne `gender` in der Anfrage nicht. */
    applied: boolean;
  };
  /**
   * Die Firma verlangt je Fahrgast eine Ausweisnummer (`NATIONAL_ID_REQUIRED` beim Hold). Die
   * Oberfläche fragt sie nur dann ab (ADR 0016, Datenminimierung).
   */
  nationalIdRequired: boolean;
  layout: { rows: number; columns: number };
  seats: SeatView[];
}

function stopView(stop: StopRow): StopView {
  return {
    tripStopId: stop.id,
    stationId: stop.stationId,
    cityId: stop.cityId,
    nameAr: stop.nameAr,
    nameEn: stop.nameEn,
    arrivalAt: stop.arrivalAt?.toISOString() ?? null,
    departureAt: stop.departureAt?.toISOString() ?? null,
  };
}

/** Lesende Transaktion mit einem Schnappschuss: alle Abfragen sehen denselben Stand. */
const SNAPSHOT = { isolationLevel: 'RepeatableRead' } as const;

/**
 * Suche und Sitzplan für Fahrgäste. Beides ist nur ein Schnappschuss: Verbindlich prüft erst der
 * Buchungsservice unter der Trip-Sperre (ADR 0005). Deshalb hier keine Sperre.
 */
@Injectable()
export class TripsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trips: TripsRepository,
    private readonly clock: Clock,
  ) {}

  async search(query: TripSearchQuery): Promise<TripSearchResult> {
    const { start, end } = damascusDayRange(query.date);
    return this.prisma.$transaction(async (tx) => {
      const rows = await this.trips.search(tx, {
        fromCityId: query.from,
        toCityId: query.to,
        start,
        end,
        now: this.clock.now(),
        passengers: query.passengers,
        limit: query.limit + 1,
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      });
      const page = rows.slice(0, query.limit);
      const stops = await this.trips.findStops(tx, [...new Set(page.map((row) => row.tripId))]);
      const stopsByTrip = new Map<string, StopRow[]>();
      for (const stop of stops) {
        stopsByTrip.set(stop.tripId, [...(stopsByTrip.get(stop.tripId) ?? []), stop]);
      }

      const items = page.map((row): TripSearchItem => {
        const segment = (stopsByTrip.get(row.tripId) ?? []).filter(
          (stop) => stop.seq >= row.fromSeq && stop.seq <= row.toSeq,
        );
        const from = segment.find((stop) => stop.id === row.fromStopId)!;
        const to = segment.find((stop) => stop.id === row.toStopId)!;
        return {
          tripId: row.tripId,
          company: { id: row.companyId, nameAr: row.companyNameAr, nameEn: row.companyNameEn },
          departureAt: row.departureAt.toISOString(),
          arrivalAt: to.arrivalAt?.toISOString() ?? null,
          from: stopView(from),
          to: stopView(to),
          stops: segment.map(stopView),
          fare: { amountMinor: row.fareAmountMinor, currency: row.fareCurrency },
          freeSeats: capFreeSeats(row.freeSeats),
          genderRuleEnabled: row.genderRuleEnabled,
        };
      });
      const last = page.at(-1);
      const nextCursor =
        rows.length > query.limit && last !== undefined
          ? encodeSearchCursor({
              departureAt: last.departureAt,
              tripId: last.tripId,
              fromStopId: last.fromStopId,
              toStopId: last.toStopId,
            })
          : null;
      return { items, nextCursor };
    }, SNAPSHOT);
  }

  async seatMap(tripId: string, query: SeatMapQuery): Promise<SeatMapResult> {
    return this.prisma.$transaction(async (tx) => {
      const trip = await this.trips.findTrip(tx, tripId);
      // Entwürfe und Fahrten gesperrter Firmen sind nach außen unbekannt.
      if (trip === null || trip.status === 'DRAFT' || trip.company.status !== 'ACTIVE') {
        throw new AppError('TRIP_NOT_FOUND', { detail: 'The trip does not exist.' });
      }
      if (trip.status !== 'SCHEDULED') {
        throw new AppError('TRIP_NOT_BOOKABLE', { detail: 'The trip is not on sale.' });
      }
      if (trip.onlineSalesCloseAt.getTime() <= this.clock.now().getTime()) {
        throw new AppError('SALES_CLOSED', { detail: 'Online sales for this trip have ended.' });
      }
      const segment = resolveSegment(trip.stops, query.fromStopId, query.toStopId);
      if (!segment.ok) {
        throw new AppError('INVALID_SEGMENT', {
          detail: 'Boarding must be an earlier stop of this trip than alighting.',
        });
      }
      const fare = await this.trips.findFare(tx, {
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

      const inventory = await this.trips.findSeatInventory(tx, {
        tripId: trip.id,
        seatLayoutId: trip.seatLayoutId,
        ...segment.range,
        now: this.clock.now(),
      });
      const states = computeSeatStates({
        seats: inventory.seats,
        tripSeats: inventory.tripSeats,
        occupations: inventory.occupations,
        neighbors: inventory.neighbors,
        segment: segment.range,
        genderRuleEnabled: trip.genderRuleEnabled,
        ...(query.gender === undefined ? {} : { gender: query.gender }),
      });

      return {
        tripId: trip.id,
        company: { id: trip.company.id, nameAr: trip.company.nameAr, nameEn: trip.company.nameEn },
        from: stopView(segment.from),
        to: stopView(segment.to),
        fare,
        genderRule: {
          enabled: trip.genderRuleEnabled,
          applied: trip.genderRuleEnabled && query.gender !== undefined,
        },
        nationalIdRequired: trip.company.requireNationalId,
        layout: {
          rows: Math.max(0, ...inventory.seats.map((seat) => seat.rowIndex + 1)),
          columns: Math.max(0, ...inventory.seats.map((seat) => seat.colIndex + 1)),
        },
        seats: inventory.seats.map((seat) => ({
          seatId: seat.id,
          label: seat.label,
          row: seat.rowIndex,
          column: seat.colIndex,
          side: seat.side,
          state: states.get(seat.id) ?? 'BLOCKED',
        })),
      };
    }, SNAPSHOT);
  }
}
