import { localDateInDamascus } from '@masar/shared';

/**
 * Plant eine Fahrt aus Route, Sitzplan und Firmeneinstellungen (ADR 0005, 0006, 0007).
 *
 * Die Fahrt ist ein Schnappschuss: Halte, Kontingent, Fristen und Geschlechtsregel werden beim
 * Anlegen kopiert. Spätere Änderungen an Route oder Firma ändern bestehende Fahrten nicht.
 * Rein und ohne Datenbank, damit Seed, Tests und später das Portal dieselben Regeln nutzen.
 */

export interface PlanRouteStop {
  readonly routeStopId: string;
  readonly stationId: string;
  readonly seq: number;
}

/** Zeiten je Halt in Routenreihenfolge. Erster Halt ohne Ankunft, letzter ohne Abfahrt. */
export interface PlanStopTime {
  readonly arrivalAt: Date | null;
  readonly departureAt: Date | null;
}

export interface PlanSeat {
  readonly seatId: string;
  readonly label: string;
  readonly isSellable: boolean;
}

export interface PlanCompanySettings {
  readonly genderRuleEnabled: boolean;
  readonly onlineSalesCloseMinutes: number;
  readonly cashDeadlineMinutes: number;
}

export interface TripPlanInput {
  readonly routeStops: readonly PlanRouteStop[];
  readonly stopTimes: readonly PlanStopTime[];
  readonly seats: readonly PlanSeat[];
  /** Beschriftungen der Sitze, die nur der Schalter verkauft (ADR 0007). */
  readonly offlineSeatLabels?: readonly string[];
  /** Beschriftungen der Sitze, die für alle Kanäle gesperrt sind. */
  readonly blockedSeatLabels?: readonly string[];
  readonly company: PlanCompanySettings;
}

export interface PlannedStop {
  readonly routeStopId: string;
  readonly stationId: string;
  readonly seq: number;
  readonly arrivalAt: Date | null;
  readonly departureAt: Date | null;
}

export interface PlannedSeat {
  readonly seatId: string;
  readonly onlineSellable: boolean;
  readonly blocked: boolean;
}

export interface TripPlan {
  /** Kalendertag der Abfahrt am ersten Halt in Damaskus, `YYYY-MM-DD`. */
  readonly serviceDate: string;
  readonly departureAt: Date;
  readonly arrivalAt: Date;
  readonly onlineSalesCloseAt: Date;
  readonly cashDeadlineAt: Date;
  readonly genderRuleEnabled: boolean;
  readonly stops: readonly PlannedStop[];
  readonly seats: readonly PlannedSeat[];
}

/** Ungültige Eingabe für eine Fahrt. Die Meldung enthält nur Positionen und Beschriftungen. */
export class TripPlanError extends Error {
  override readonly name = 'TripPlanError';
}

const MINUTE_MS = 60_000;

function assertMinutes(value: number, what: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new TripPlanError(`${what} muss eine ganze Zahl ab 0 sein`);
  }
}

function planStops(
  routeStops: readonly PlanRouteStop[],
  stopTimes: readonly PlanStopTime[],
): PlannedStop[] {
  if (routeStops.length < 2) {
    throw new TripPlanError('Eine Fahrt braucht mindestens zwei Halte');
  }
  if (stopTimes.length !== routeStops.length) {
    throw new TripPlanError('Für jeden Halt wird genau ein Zeiteintrag erwartet');
  }
  const ordered = [...routeStops].sort((a, b) => a.seq - b.seq);
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i]?.seq === ordered[i - 1]?.seq) {
      throw new TripPlanError('Routenhalte haben doppelte Positionen');
    }
  }
  const last = ordered.length - 1;
  let previousDeparture: Date | null = null;

  return ordered.map((stop, index) => {
    const times = stopTimes[index] as PlanStopTime;
    const arrivalAt = index === 0 ? null : times.arrivalAt;
    const departureAt = index === last ? null : times.departureAt;
    if (index > 0 && arrivalAt === null) {
      throw new TripPlanError(`Halt ${index} braucht eine Ankunftszeit`);
    }
    if (index < last && departureAt === null) {
      throw new TripPlanError(`Halt ${index} braucht eine Abfahrtszeit`);
    }
    if (arrivalAt !== null && departureAt !== null && departureAt < arrivalAt) {
      throw new TripPlanError(`Halt ${index}: Abfahrt liegt vor der Ankunft`);
    }
    if (previousDeparture !== null && arrivalAt !== null && arrivalAt <= previousDeparture) {
      throw new TripPlanError(`Halt ${index}: Ankunft liegt nicht nach der vorigen Abfahrt`);
    }
    previousDeparture = departureAt;
    // Positionen der Fahrt sind lückenlos ab 0, auch wenn die Route Lücken hat (z. B. 10, 20, 30).
    return {
      routeStopId: stop.routeStopId,
      stationId: stop.stationId,
      seq: index,
      arrivalAt,
      departureAt,
    };
  });
}

function planSeats(
  seats: readonly PlanSeat[],
  offlineLabels: readonly string[],
  blockedLabels: readonly string[],
): PlannedSeat[] {
  if (seats.length === 0) {
    throw new TripPlanError('Der Sitzplan hat keine Sitze');
  }
  const known = new Set(seats.map((s) => s.label));
  // Ein Tippfehler im Kontingent soll auffallen, statt einen Sitz still online zu verkaufen.
  for (const label of [...offlineLabels, ...blockedLabels]) {
    if (!known.has(label)) {
      throw new TripPlanError(`Sitz ${label} gibt es im Sitzplan nicht`);
    }
  }
  const offline = new Set(offlineLabels);
  const blocked = new Set(blockedLabels);
  return seats.map((seat) => {
    const isBlocked = !seat.isSellable || blocked.has(seat.label);
    return {
      seatId: seat.seatId,
      onlineSellable: !isBlocked && !offline.has(seat.label),
      blocked: isBlocked,
    };
  });
}

export function planTrip(input: TripPlanInput): TripPlan {
  const { company } = input;
  assertMinutes(company.onlineSalesCloseMinutes, 'Ende des Online-Verkaufs');
  assertMinutes(company.cashDeadlineMinutes, 'Barfrist');

  const stops = planStops(input.routeStops, input.stopTimes);
  const departureAt = stops[0]?.departureAt as Date;
  const arrivalAt = stops[stops.length - 1]?.arrivalAt as Date;

  return {
    serviceDate: localDateInDamascus(departureAt),
    departureAt,
    arrivalAt,
    onlineSalesCloseAt: new Date(
      departureAt.getTime() - company.onlineSalesCloseMinutes * MINUTE_MS,
    ),
    cashDeadlineAt: new Date(departureAt.getTime() - company.cashDeadlineMinutes * MINUTE_MS),
    genderRuleEnabled: company.genderRuleEnabled,
    stops,
    seats: planSeats(input.seats, input.offlineSeatLabels ?? [], input.blockedSeatLabels ?? []),
  };
}
