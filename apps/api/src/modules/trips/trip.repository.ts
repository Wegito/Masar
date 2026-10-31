import { toDbDate } from '../../common/calendar-date.js';
import type { Prisma, TripStatus } from '../../generated/prisma/client.js';
import type { TripPlan } from './domain/trip-plan.js';

export interface NewTrip {
  readonly companyId: string;
  readonly routeId: string;
  readonly seatLayoutId: string;
  readonly busId?: string | null;
  readonly status: TripStatus;
  readonly plan: TripPlan;
}

/**
 * Schreibt eine geplante Fahrt mit Halten und Kontingent. Läuft in der Transaktion des Aufrufers:
 * Eine Fahrt ohne vollständige Halte oder Sitze darf nie sichtbar werden. Dass Route, Sitzplan und
 * Bus zur Firma passen und jeder Sitz zum Sitzplan, prüft die Datenbank über zusammengesetzte
 * Fremdschlüssel.
 */
export async function insertTrip(
  tx: Prisma.TransactionClient,
  input: NewTrip,
): Promise<{ tripId: string }> {
  const { plan } = input;
  const trip = await tx.trip.create({
    data: {
      companyId: input.companyId,
      routeId: input.routeId,
      seatLayoutId: input.seatLayoutId,
      busId: input.busId ?? null,
      status: input.status,
      serviceDate: toDbDate(plan.serviceDate),
      departureAt: plan.departureAt,
      arrivalAt: plan.arrivalAt,
      onlineSalesCloseAt: plan.onlineSalesCloseAt,
      cashDeadlineAt: plan.cashDeadlineAt,
      genderRuleEnabled: plan.genderRuleEnabled,
    },
    select: { id: true },
  });
  await tx.tripStop.createMany({
    data: plan.stops.map((stop) => ({ tripId: trip.id, ...stop })),
  });
  await tx.tripSeat.createMany({
    data: plan.seats.map((seat) => ({
      tripId: trip.id,
      seatLayoutId: input.seatLayoutId,
      seatId: seat.seatId,
      onlineSellable: seat.onlineSellable,
      blocked: seat.blocked,
    })),
  });
  return { tripId: trip.id };
}
