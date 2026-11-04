import { Injectable } from '@nestjs/common';

import type { Gender, Prisma, SeatSide, TripStatus } from '../../generated/prisma/client.js';
import { expiredCondition } from './bookings.repository.js';

type Db = Prisma.TransactionClient;

export interface CounterTripRow {
  id: string;
  companyId: string;
  status: TripStatus;
  routeId: string;
  seatLayoutId: string;
  serviceDate: Date;
  departureAt: Date;
  arrivalAt: Date;
  genderRuleEnabled: boolean;
  route: { id: string; nameAr: string; nameEn: string };
  bus: { id: string; plate: string } | null;
  company: { status: string; requireNationalId: boolean };
  stops: {
    id: string;
    seq: number;
    routeStopId: string;
    arrivalAt: Date | null;
    departureAt: Date | null;
    station: { nameAr: string; nameEn: string };
  }[];
}

export interface CounterInventory {
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
  /** Alle Belegungen aktiver Buchungen der Fahrt; das Geschlecht verlässt den Service nie. */
  occupations: { seatId: string; fromSeq: number; toSeq: number; gender: Gender | null }[];
}

/**
 * Lesender Zugriff für den Sitzplan des Schalters (Schritt 2.6). Schreibt nie: Verkauf und Storno
 * laufen über den `BookingsService` unter der Trip-Sperre.
 */
@Injectable()
export class CounterRepository {
  /** Fahrt der Firma mit Halten, Strecke und Bus; eine fremde Fahrt ist `null`. */
  async findTrip(db: Db, companyId: string, tripId: string): Promise<CounterTripRow | null> {
    return db.trip.findFirst({
      where: { id: tripId, companyId },
      select: {
        id: true,
        companyId: true,
        status: true,
        routeId: true,
        seatLayoutId: true,
        serviceDate: true,
        departureAt: true,
        arrivalAt: true,
        genderRuleEnabled: true,
        route: { select: { id: true, nameAr: true, nameEn: true } },
        bus: { select: { id: true, plate: true } },
        company: { select: { status: true, requireNationalId: true } },
        stops: {
          select: {
            id: true,
            seq: true,
            routeStopId: true,
            arrivalAt: true,
            departureAt: true,
            station: { select: { nameAr: true, nameEn: true } },
          },
          orderBy: { seq: 'asc' },
        },
      },
    });
  }

  /**
   * Sitze, Kontingent, Nachbarpaare und alle Belegungen der Fahrt. Belegungen abgelaufener, noch
   * nicht freigegebener Buchungen zählen nicht (dieselbe Regel wie der Ablauf-Job).
   */
  async inventory(
    db: Db,
    input: { tripId: string; seatLayoutId: string; now: Date },
  ): Promise<CounterInventory> {
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
    const occupations = await db.$queryRaw<CounterInventory['occupations']>`
      SELECT so.seat_id AS "seatId", so.from_seq AS "fromSeq", so.to_seq AS "toSeq", so.gender
      FROM seat_occupation so
      JOIN booking b ON b.id = so.booking_id
      WHERE so.trip_id = ${input.tripId}::uuid AND NOT ${expiredCondition(input.now)}`;
    return { seats, tripSeats, neighbors, occupations };
  }
}
