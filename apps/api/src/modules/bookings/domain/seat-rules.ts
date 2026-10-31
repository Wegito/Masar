import type { BookingChannel, Gender } from '@masar/shared';

/**
 * Regeln für die Belegung eines Sitzes (ADR 0005, 0006, 0007). Rein und ohne Datenbank.
 *
 * Der Sitzplan (Anzeige) und der Buchungskern (Prüfung unter der Trip-Sperre) nutzen dieselben
 * Funktionen, damit die Oberfläche nie „frei“ zeigt, was die Buchung ablehnt, und umgekehrt.
 */

/** Teilstrecke als halboffenes Intervall [fromSeq, toSeq). */
export interface Segment {
  readonly fromSeq: number;
  readonly toSeq: number;
}

export interface Occupation extends Segment {
  readonly seatId: string;
  readonly bookingId: string;
  /** null, wenn die Belegung ohne Angabe entstand; zählt bei aktiver Regel als Konflikt. */
  readonly gender: Gender | null;
}

/** [0,2) und [2,4) überlappen nicht: Der Sitz wird am Ausstiegshalt frei. */
export function segmentsOverlap(a: Segment, b: Segment): boolean {
  return a.fromSeq < b.toSeq && b.fromSeq < a.toSeq;
}

export function isSeatTaken(
  seatId: string,
  segment: Segment,
  occupations: readonly Occupation[],
): boolean {
  return occupations.some((o) => o.seatId === seatId && segmentsOverlap(o, segment));
}

export interface GenderCheck {
  readonly seatId: string;
  readonly segment: Segment;
  readonly gender: Gender;
  /** Fahrgäste derselben Buchung sind ausgenommen (Familie, Paar). Ohne Angabe: neue Buchung. */
  readonly bookingId?: string;
  readonly occupations: readonly Occupation[];
  /** Nachbarn je Sitz aus `seat_neighbor`. */
  readonly neighborsOf: ReadonlyMap<string, readonly string[]>;
}

/**
 * Geschlechtsregel (ADR 0006): Konflikt, wenn ein Nachbarsitz auf einer überlappenden Teilstrecke
 * von einer anderen Buchung belegt ist und das Geschlecht abweicht oder fehlt.
 */
export function hasGenderConflict(check: GenderCheck): boolean {
  const neighbors = check.neighborsOf.get(check.seatId) ?? [];
  return check.occupations.some(
    (o) =>
      neighbors.includes(o.seatId) &&
      o.bookingId !== check.bookingId &&
      segmentsOverlap(o, check.segment) &&
      o.gender !== check.gender,
  );
}

export type SaleRestriction = 'BLOCKED' | 'NOT_ONLINE' | null;

/**
 * Kontingent (ADR 0007): `blocked` gilt für alle Kanäle. Nur der Kanal ONLINE verlangt
 * `onlineSellable`; Schalter und Admin verkaufen auch Sitze außerhalb des Online-Kontingents.
 */
export function saleRestriction(
  seat: { readonly onlineSellable: boolean; readonly blocked: boolean },
  channel: BookingChannel,
): SaleRestriction {
  if (seat.blocked) {
    return 'BLOCKED';
  }
  if (channel === 'ONLINE' && !seat.onlineSellable) {
    return 'NOT_ONLINE';
  }
  return null;
}

/** Nachbarliste je Sitz aus den gespeicherten Paaren (jedes Paar steht in beiden Richtungen). */
export function neighborMap(
  pairs: readonly { readonly seatId: string; readonly neighborSeatId: string }[],
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const { seatId, neighborSeatId } of pairs) {
    const list = map.get(seatId);
    if (list === undefined) {
      map.set(seatId, [neighborSeatId]);
    } else {
      list.push(neighborSeatId);
    }
  }
  return map;
}
