/**
 * Strecken, Haltestellen, Tarife und Stornoregeln (Schritt 2.3, ADR 0026). API und Portal prüfen
 * dieselben Grenzen.
 */

/** ACTIVE nimmt neue Fahrten an; ARCHIVED nicht mehr (bestehende Fahrten bleiben). */
export const ROUTE_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export type RouteStatus = (typeof ROUTE_STATUSES)[number];

export const ROUTE_LIMITS = {
  minStops: 2,
  maxStops: 15,
  maxNameLength: 120,
  /** Höchster Tarif in Minor-Units (10 Millionen SYP); bleibt weit unter `integer`. */
  maxFareMinor: 1_000_000_000,
} as const;

export const CANCELLATION_POLICY_LIMITS = {
  maxNameLength: 60,
  maxRules: 10,
  /** Höchste Stufe: 30 Tage vor Abfahrt. */
  maxMinutesBeforeDeparture: 30 * 24 * 60,
  maxFeeBps: 10_000,
} as const;

/** Zahl der Halt-Paare in Fahrtrichtung, die eine vollständige Tarifmatrix braucht. */
export function farePairCount(stopCount: number): number {
  return stopCount < 2 ? 0 : (stopCount * (stopCount - 1)) / 2;
}
