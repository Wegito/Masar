import { addDaysToCalendarDate, instantFromDamascusLocal } from '@masar/shared';
import { Injectable } from '@nestjs/common';

import { AppError } from '../../common/app-error.js';
import { Clock } from '../../common/clock.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { neighborMap } from '../bookings/domain/seat-rules.js';
import { cappedAvailability, computeSeatMap } from './domain/seat-map.js';
import { findFare, findTripOffers, loadSeatMapData } from './trip-read.repository.js';
import type { SeatMapQuery, TripSearchQuery } from './trips.schemas.js';

const SEARCH_LIMIT = 100;

interface LocalizedName {
  nameAr: string;
  nameEn: string;
}

/**
 * Suche und Sitzplan für Fahrgäste. Nur lesend und ohne Sperre: Was hier frei aussieht, prüft der
 * Buchungskern unter der Trip-Sperre noch einmal (ADR 0005).
 */
@Injectable()
export class TripsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async search(query: TripSearchQuery) {
    const rows = await findTripOffers(this.prisma, {
      fromCity: query.from,
      toCity: query.to,
      dayStart: instantFromDamascusLocal(query.date, '00:00'),
      dayEnd: instantFromDamascusLocal(addDaysToCalendarDate(query.date, 1), '00:00'),
      now: this.clock.now(),
      limit: SEARCH_LIMIT,
    });
    return {
      date: query.date,
      trips: rows.map((row) => ({
        tripId: row.trip_id,
        company: { nameAr: row.company_name_ar, nameEn: row.company_name_en },
        genderRuleEnabled: row.gender_rule_enabled,
        from: {
          seq: row.from_seq,
          station: { nameAr: row.from_station_name_ar, nameEn: row.from_station_name_en },
          departureAt: row.from_departure_at.toISOString(),
        },
        to: {
          seq: row.to_seq,
          station: { nameAr: row.to_station_name_ar, nameEn: row.to_station_name_en },
          arrivalAt: row.to_arrival_at.toISOString(),
        },
        fare: { amountMinor: row.amount_minor, currency: row.currency },
        seats: cappedAvailability(row.free_seats),
      })),
    };
  }

  async seatMap(tripId: string, query: SeatMapQuery) {
    const segment = { fromSeq: query.fromSeq, toSeq: query.toSeq };
    const data = await loadSeatMapData(this.prisma, tripId, segment);
    // Entwürfe und Fahrten gesperrter Firmen sind öffentlich nicht sichtbar.
    if (data === null || data.trip.status === 'DRAFT' || data.trip.company.status !== 'ACTIVE') {
      throw new AppError('TRIP_NOT_FOUND');
    }
    const { trip } = data;
    if (trip.status !== 'SCHEDULED') {
      throw new AppError('TRIP_NOT_BOOKABLE');
    }
    if (this.clock.now() >= trip.onlineSalesCloseAt) {
      throw new AppError('SALES_CLOSED');
    }
    const from = trip.stops.find((s) => s.seq === segment.fromSeq);
    const to = trip.stops.find((s) => s.seq === segment.toSeq);
    if (from === undefined || to === undefined || segment.fromSeq >= segment.toSeq) {
      throw new AppError('INVALID_SEGMENT');
    }
    if (trip.genderRuleEnabled && query.gender === undefined) {
      throw new AppError('GENDER_REQUIRED');
    }
    const fare = await findFare(this.prisma, from.routeStopId, to.routeStopId, trip.serviceDate);
    if (fare === null) {
      throw new AppError('NO_FARE_FOR_SEGMENT');
    }

    const seats = computeSeatMap({
      seats: data.seats.map((s) => ({
        seatId: s.seat.id,
        label: s.seat.label,
        rowIndex: s.seat.rowIndex,
        colIndex: s.seat.colIndex,
        side: s.seat.side,
        onlineSellable: s.onlineSellable,
        blocked: s.blocked,
      })),
      occupations: data.occupations,
      neighborsOf: neighborMap(data.neighbors),
      segment,
      genderRuleEnabled: trip.genderRuleEnabled,
      gender: trip.genderRuleEnabled ? (query.gender ?? null) : null,
    });
    const stopView = (station: LocalizedName, seq: number, at: Date | null) => ({
      seq,
      station: { nameAr: station.nameAr, nameEn: station.nameEn },
      at: at?.toISOString() ?? null,
    });
    return {
      tripId: trip.id,
      company: { nameAr: trip.company.nameAr, nameEn: trip.company.nameEn },
      genderRuleEnabled: trip.genderRuleEnabled,
      from: stopView(from.station, from.seq, from.departureAt),
      to: stopView(to.station, to.seq, to.arrivalAt),
      fare,
      layout: {
        pattern: trip.seatLayout.pattern,
        rows: Math.max(...seats.map((s) => s.rowIndex)) + 1,
        columns: Math.max(...seats.map((s) => s.colIndex)) + 1,
      },
      seats: seats.map((s) => ({
        seatId: s.seatId,
        label: s.label,
        row: s.rowIndex,
        column: s.colIndex,
        side: s.side,
        state: s.state,
      })),
    };
  }
}
