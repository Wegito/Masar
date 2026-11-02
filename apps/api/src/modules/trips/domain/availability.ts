/**
 * Anzeige freier Sitze in der Suche (ADR 0007). Reine Funktion ohne Ein- und Ausgabe.
 *
 * Die Zahl wird gekappt („9+"), damit die Auslastung einer Fahrt nicht ablesbar ist. Die Kappung
 * entspricht der Höchstzahl an Fahrgästen je Suche: Wer neun Plätze sucht, erfährt nur, dass
 * genug da sind.
 */

export const FREE_SEATS_DISPLAY_CAP = 9;

export interface FreeSeatsDisplay {
  /** Exakte Zahl unterhalb der Kappung, sonst die Kappung selbst. */
  count: number;
  /** `true` heißt „mindestens `count`" (Anzeige „9+"). */
  capped: boolean;
}

export function capFreeSeats(freeSeats: number, cap = FREE_SEATS_DISPLAY_CAP): FreeSeatsDisplay {
  if (!Number.isInteger(freeSeats) || freeSeats < 0) {
    throw new RangeError(`Ungültige Zahl freier Sitze: ${freeSeats}`);
  }
  return freeSeats >= cap ? { count: cap, capped: true } : { count: freeSeats, capped: false };
}
