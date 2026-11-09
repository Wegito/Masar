import type { Gender, SeatState } from '@masar/shared';

import type { SeatView } from './types';

/**
 * Zuordnung von Sitzen zu Fahrgästen (ADR 0034). Reine Funktionen, im Browser genutzt.
 *
 * Die Fahrgastdaten stehen vor der Sitzwahl fest; der Sitzplan kommt mit `notFor` je Sitz (die
 * Geschlechter dieser Buchung, für die der Sitz nach der Geschlechtsregel gesperrt ist). Für
 * Fahrgast i zählt nur sein eigenes Geschlecht. Sitze, die andere Fahrgäste derselben Buchung
 * wählen, sperren nichts: Wer zusammen bucht, darf zusammen sitzen (ADR 0006). Verbindlich prüft
 * der Hold unter der Trip-Sperre; diese Funktionen sind nur Komfort.
 */

/** Sitz je Fahrgast in der Reihenfolge der Fahrgastdaten; `null` heißt noch kein Sitz. */
export type Assignment = readonly (string | null)[];

export function emptyAssignment(passengers: number): (string | null)[] {
  return Array.from({ length: passengers }, () => null);
}

/**
 * Status des Sitzes für einen Fahrgast. Ohne Geschlecht (Fahrt ohne Regel) gilt der Status der
 * API. `NOT_FOR_YOU` zeigt die Oberfläche wie einen gesperrten Sitz, ohne Grund.
 */
export function seatStateFor(seat: SeatView, gender: Gender | null): SeatState {
  if (seat.state === 'FREE' && gender !== null && seat.notFor.includes(gender)) {
    return 'NOT_FOR_YOU';
  }
  return seat.state;
}

export function isSelectableFor(seat: SeatView, gender: Gender | null): boolean {
  return seatStateFor(seat, gender) === 'FREE';
}

/** Welcher Fahrgast (Index) hat den Sitz? `null`, wenn keiner. */
export function passengerOfSeat(assignment: Assignment, seatId: string): number | null {
  const index = assignment.indexOf(seatId);
  return index === -1 ? null : index;
}

/**
 * Sitz für Fahrgast `passenger` umschalten: Hat er den Sitz, gibt er ihn ab; sonst bekommt er ihn
 * und gibt seinen bisherigen ab. Sitze anderer Fahrgäste und für ihn gesperrte Sitze ändern nichts.
 */
export function toggleSeatFor(
  assignment: Assignment,
  passenger: number,
  seat: SeatView,
  gender: Gender | null,
): (string | null)[] {
  const next = [...assignment];
  if (passenger < 0 || passenger >= next.length) {
    return next;
  }
  if (next[passenger] === seat.seatId) {
    next[passenger] = null;
    return next;
  }
  const owner = passengerOfSeat(next, seat.seatId);
  if (owner !== null || !isSelectableFor(seat, gender)) {
    return next;
  }
  next[passenger] = seat.seatId;
  return next;
}

/**
 * Nächster Fahrgast ohne Sitz, beginnend nach `current` und reihum; haben alle einen Sitz, bleibt
 * es bei `current`.
 */
export function nextPassenger(assignment: Assignment, current: number): number {
  const count = assignment.length;
  for (let step = 1; step <= count; step += 1) {
    const index = (current + step) % count;
    if (assignment[index] === null) {
      return index;
    }
  }
  return current;
}

/**
 * Nach einem neu geladenen Sitzplan oder geänderten Fahrgastdaten: Jeder Fahrgast behält seinen
 * Sitz nur, wenn der Sitz für sein Geschlecht noch wählbar ist. Die Anzahl Fahrgäste kann sich
 * nicht ändern; fehlende Einträge werden `null`.
 */
export function keepValidAssignment(
  assignment: Assignment,
  seats: readonly SeatView[],
  genders: readonly (Gender | null)[],
): (string | null)[] {
  const byId = new Map(seats.map((seat) => [seat.seatId, seat]));
  return genders.map((gender, index) => {
    const seatId = assignment[index] ?? null;
    const seat = seatId === null ? undefined : byId.get(seatId);
    return seat !== undefined && isSelectableFor(seat, gender) ? seatId : null;
  });
}

export function assignedCount(assignment: Assignment): number {
  return assignment.filter((seatId) => seatId !== null).length;
}

/** Sitze in der Reihenfolge der Fahrgäste, sobald jeder einen hat; sonst `null`. */
export function completeSeats(assignment: Assignment): string[] | null {
  return assignment.every((seatId) => seatId !== null) ? [...(assignment as string[])] : null;
}

/** Freie Sitze, die mindestens einer der Fahrgäste wählen kann, ohne doppelte Zählung. */
export function selectableSeatCount(
  seats: readonly SeatView[],
  genders: readonly (Gender | null)[],
): number {
  const list = genders.length === 0 ? [null] : genders;
  return seats.filter((seat) => list.some((gender) => isSelectableFor(seat, gender))).length;
}

/** Geschlechter der Buchung ohne Doppelte, für die Sitzplan-Anfrage (ADR 0034). */
export function distinctGenders(genders: readonly (Gender | null)[]): Gender[] {
  return (['FEMALE', 'MALE'] as const).filter((gender) => genders.includes(gender));
}
