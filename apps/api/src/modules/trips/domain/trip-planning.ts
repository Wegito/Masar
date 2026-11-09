import type { ScheduleItemState } from '@masar/shared';

import type { PlannedTrip } from './trip-schedule.js';

/**
 * Entscheidungen der Fahrtplanung (Schritt 2.4, ADR 0027). Reine Funktionen ohne Ein- und Ausgabe;
 * der Service liest die Daten unter Sperre und ruft sie auf. Vorschau und Veröffentlichung nutzen
 * dieselben Funktionen, damit das Portal genau das zeigt, was danach entsteht.
 */

const MINUTE_MS = 60_000;

// --- Zeiten der Halte ----------------------------------------------------------------------------

export interface StopTime {
  seq: number;
  /** Ankunft; am ersten Halt `null`. */
  arrivalAt: Date | null;
  /** Abfahrt; am letzten Halt `null`. */
  departureAt: Date | null;
}

/**
 * Minuten ab Abfahrt für die Zwischenhalte, gleichmäßig über die Fahrzeit verteilt und auf ganze
 * Minuten gerundet. Bei vier Halten und 300 Minuten: 100 und 200.
 */
export function evenStopOffsets(stopCount: number, durationMinutes: number): number[] {
  const legs = stopCount - 1;
  const offsets: number[] = [];
  for (let index = 1; index < legs; index += 1) {
    offsets.push(Math.round((durationMinutes * index) / legs));
  }
  return offsets;
}

/**
 * Prüft eigene Minuten für die Zwischenhalte: genau einer je Zwischenhalt, streng steigend, nach
 * der Abfahrt und vor der Ankunft am letzten Halt. Ohne Angabe gilt {@link evenStopOffsets}.
 */
export function stopOffsetsIssue(
  stopCount: number,
  durationMinutes: number,
  offsets: readonly number[] | undefined,
): 'TRIP_STOP_OFFSETS_INVALID' | null {
  if (offsets === undefined) {
    // Gleichmäßig verteilt geht nur, wenn jeder Abschnitt mindestens eine Minute hat.
    return durationMinutes >= stopCount - 1 ? null : 'TRIP_STOP_OFFSETS_INVALID';
  }
  if (offsets.length !== Math.max(stopCount - 2, 0)) {
    return 'TRIP_STOP_OFFSETS_INVALID';
  }
  let previous = 0;
  for (const offset of offsets) {
    if (!Number.isInteger(offset) || offset <= previous || offset >= durationMinutes) {
      return 'TRIP_STOP_OFFSETS_INVALID';
    }
    previous = offset;
  }
  return null;
}

/**
 * Zeiten aller Halte einer Fahrt. Erster Halt nur mit Abfahrt, letzter nur mit Ankunft; an
 * Zwischenhalten sind Ankunft und Abfahrt gleich (keine Standzeit im MVP). Die Suche filtert über
 * die Abfahrt am Einstiegshalt (ADR 0012), deshalb hat jeder Halt außer dem letzten eine Abfahrt.
 */
export function planStopTimes(
  stopCount: number,
  planned: Pick<PlannedTrip, 'departureAt' | 'arrivalAt'>,
  offsets: readonly number[],
): StopTime[] {
  const at = (minutes: number): Date =>
    new Date(planned.departureAt.getTime() + minutes * MINUTE_MS);
  const times: StopTime[] = [];
  for (let seq = 0; seq < stopCount; seq += 1) {
    if (seq === 0) {
      times.push({ seq, arrivalAt: null, departureAt: planned.departureAt });
    } else if (seq === stopCount - 1) {
      times.push({ seq, arrivalAt: planned.arrivalAt, departureAt: null });
    } else {
      const time = at(offsets[seq - 1] ?? 0);
      times.push({ seq, arrivalAt: time, departureAt: time });
    }
  }
  return times;
}

// --- Busbelegung ---------------------------------------------------------------------------------

export interface TimeSpan {
  start: Date;
  end: Date;
}

/** Halboffene Zeiträume `[start, end)`: Wer um 12:00 ankommt, darf um 12:00 wieder abfahren. */
export function spansOverlap(a: TimeSpan, b: TimeSpan): boolean {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
}

/**
 * Positionen geplanter Fahrten, die den Bus doppelt belegen: mit einer bestehenden Fahrt oder mit
 * einer anderen geplanten Fahrt derselben Veröffentlichung. Gestrichene Fahrten gibt der Aufrufer
 * gar nicht erst mit.
 */
export function busConflicts(
  planned: readonly TimeSpan[],
  existing: readonly TimeSpan[],
): number[] {
  const conflicts = new Set<number>();
  planned.forEach((span, index) => {
    if (existing.some((other) => spansOverlap(span, other))) {
      conflicts.add(index);
    }
    for (let other = index + 1; other < planned.length; other += 1) {
      if (spansOverlap(span, planned[other]!)) {
        conflicts.add(index);
        conflicts.add(other);
      }
    }
  });
  return [...conflicts].sort((a, b) => a - b);
}

// --- Kontingent ----------------------------------------------------------------------------------

export interface LayoutSeat {
  id: string;
  rowIndex: number;
  colIndex: number;
  isSellable: boolean;
}

/** Sitze, die verkauft werden können (der Generator setzt alle verkaufbar). */
export function sellableSeatCount(seats: readonly LayoutSeat[]): number {
  return seats.filter((seat) => seat.isSellable).length;
}

/**
 * Online-Kontingent je Sitz (ADR 0007). Die ersten `onlineCount` verkaufbaren Sitze von vorn nach
 * hinten (Reihe, dann Spalte) sind online; der Rest bleibt dem Schalter. Ohne Angabe sind alle
 * verkaufbaren Sitze online. Nicht verkaufbare Sitze sind nie online.
 */
export function onlineQuota(
  seats: readonly LayoutSeat[],
  onlineCount: number | undefined,
): Map<string, boolean> {
  const ordered = [...seats].sort((a, b) => a.rowIndex - b.rowIndex || a.colIndex - b.colIndex);
  const limit = onlineCount ?? Number.POSITIVE_INFINITY;
  const result = new Map<string, boolean>();
  let online = 0;
  for (const seat of ordered) {
    const isOnline = seat.isSellable && online < limit;
    if (isOnline) online += 1;
    result.set(seat.id, isOnline);
  }
  return result;
}

// --- Tarife ----------------------------------------------------------------------------------------

export interface FareValidity {
  fromSeq: number;
  toSeq: number;
  /** Kalendertag `YYYY-MM-DD`, einschließlich. */
  validFrom: string;
  /** Kalendertag `YYYY-MM-DD`, ausschließlich; `null` heißt unbefristet. */
  validUntil: string | null;
}

/**
 * Fahrtage, an denen nicht jede Teilstrecke einen gültigen Tarif hat. Gültig heißt
 * `validFrom ≤ Fahrtag < validUntil` (Domänenmodell, Umsetzung 1.2). Eine Lücke lässt Teilstrecken
 * der Fahrt still aus der Suche fallen; deshalb lehnt die Veröffentlichung solche Tage ab.
 */
export function datesWithoutFares(
  serviceDates: readonly string[],
  stopCount: number,
  fares: readonly FareValidity[],
): string[] {
  const missing: string[] = [];
  for (const day of new Set(serviceDates)) {
    const covered = new Set<string>();
    for (const fare of fares) {
      if (fare.validFrom <= day && (fare.validUntil === null || day < fare.validUntil)) {
        covered.add(`${fare.fromSeq}-${fare.toSeq}`);
      }
    }
    let complete = true;
    for (let from = 0; from < stopCount && complete; from += 1) {
      for (let to = from + 1; to < stopCount; to += 1) {
        if (!covered.has(`${from}-${to}`)) {
          complete = false;
          break;
        }
      }
    }
    if (!complete) missing.push(day);
  }
  return missing.sort();
}

// --- Termine ----------------------------------------------------------------------------------------

/**
 * Ein Termin liegt in der Vergangenheit, wenn der erste Tag vor heute (Damaskus) liegt oder eine
 * Abfahrt nicht mehr in der Zukunft ist.
 */
export function scheduleInPast(
  fromDate: string,
  today: string,
  planned: readonly Pick<PlannedTrip, 'departureAt'>[],
  now: Date,
): boolean {
  return fromDate < today || planned.some((trip) => trip.departureAt.getTime() <= now.getTime());
}

export interface ExistingTrip {
  id: string;
  departureAt: Date;
}

export interface ScheduleItem {
  planned: PlannedTrip;
  state: ScheduleItemState;
  /** Bei `EXISTS`: die vorhandene Fahrt. */
  existingTripId: string | null;
}

/**
 * Ordnet jedem Termin seinen Zustand zu. `EXISTS`: Dieselbe Fahrt (Strecke, Abfahrt und Bus bzw.
 * Sitzplan) gibt es schon; sie wird übersprungen, auch wenn sie gestrichen ist. Ein zweiter Aufruf
 * desselben Plans erzeugt damit nichts doppelt und holt keine abgesagte Fahrt zurück.
 * `BUS_CONFLICT`: Der Bus ist in der Zeit schon unterwegs (bestehende oder andere neue Fahrt).
 */
export function classifySchedule(
  planned: readonly PlannedTrip[],
  sameSlot: readonly ExistingTrip[],
  busBusy: readonly TimeSpan[],
): ScheduleItem[] {
  const existingByDeparture = new Map(
    sameSlot.map((trip) => [trip.departureAt.getTime(), trip.id] as const),
  );
  const fresh = planned.filter((trip) => !existingByDeparture.has(trip.departureAt.getTime()));
  const conflictIndexes = new Set(
    busConflicts(
      fresh.map((trip) => ({ start: trip.departureAt, end: trip.arrivalAt })),
      busBusy,
    ),
  );
  const conflicting = new Set(fresh.filter((_, index) => conflictIndexes.has(index)));
  return planned.map((trip) => {
    const existingTripId = existingByDeparture.get(trip.departureAt.getTime()) ?? null;
    const state: ScheduleItemState =
      existingTripId !== null ? 'EXISTS' : conflicting.has(trip) ? 'BUS_CONFLICT' : 'NEW';
    return { planned: trip, state, existingTripId };
  });
}

/** Online-Verkaufsschluss: `minutes` vor der Abfahrt am Starthalt. */
export function onlineSalesCloseAt(departureAt: Date, minutes: number): Date {
  return new Date(departureAt.getTime() - minutes * MINUTE_MS);
}

// --- Kontingent einer bestehenden Fahrt ------------------------------------------------------------

export interface TripSeatState {
  seatId: string;
  label: string;
  onlineSellable: boolean;
  /** Mindestens eine Belegung auf irgendeiner Teilstrecke (aktive Buchung). */
  occupied: boolean;
}

export interface QuotaChange {
  seatId: string;
  onlineSellable: boolean;
}

export type QuotaPlan =
  | { kind: 'OK'; changes: QuotaChange[] }
  | { kind: 'SEAT_UNKNOWN'; seatIds: string[] }
  | { kind: 'TRIP_SEAT_OCCUPIED'; labels: string[] };

/**
 * Welche Kontingent-Änderungen wirken. Nur Sitze, deren Wert sich ändert, zählen; ein belegter Sitz
 * wechselt nie den Kanal, damit eine Online-Buchung nicht nachträglich auf einem Schalterplatz
 * sitzt und umgekehrt (ADR 0007). Doppelte Angaben für denselben Sitz: die letzte gilt.
 */
export function planQuotaChange(
  seats: readonly TripSeatState[],
  changes: readonly QuotaChange[],
): QuotaPlan {
  const byId = new Map(seats.map((seat) => [seat.seatId, seat]));
  const unknown = [...new Set(changes.map((c) => c.seatId).filter((id) => !byId.has(id)))];
  if (unknown.length > 0) {
    return { kind: 'SEAT_UNKNOWN', seatIds: unknown.sort() };
  }
  const last = new Map(changes.map((change) => [change.seatId, change.onlineSellable]));
  const effective = [...last]
    .filter(([seatId, value]) => byId.get(seatId)!.onlineSellable !== value)
    .map(([seatId, onlineSellable]) => ({ seatId, onlineSellable }));
  const occupied = effective
    .map((change) => byId.get(change.seatId)!)
    .filter((seat) => seat.occupied)
    .map((seat) => seat.label);
  if (occupied.length > 0) {
    return { kind: 'TRIP_SEAT_OCCUPIED', labels: occupied.sort() };
  }
  return { kind: 'OK', changes: effective };
}
