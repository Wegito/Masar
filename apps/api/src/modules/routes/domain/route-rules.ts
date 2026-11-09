import type { RouteStatus } from '@masar/shared';

/**
 * Regeln für Strecken (Schritt 2.3, ADR 0026). Reine Funktionen: Der Service liest den Zustand
 * unter der Sperre der Strecke und fragt hier, ob die Änderung erlaubt ist.
 */

/**
 * Art der Änderung:
 * - `structure`: Halte und ihre Reihenfolge, Stornoregel. Fahrten kopieren die Halte und
 *   Buchungen stornieren nach der Regel der Strecke; beides darf sich unter bestehenden Fahrten
 *   nicht verschieben.
 * - `names`: Anzeigenamen, ohne Wirkung auf Inventar und Preise.
 * - `fares`: neuer Tarifstand ab einem Tag; Buchungen behalten ihren Preis.
 */
export type RouteChange = 'structure' | 'names' | 'fares';

export function routeChangeBlocker(
  state: { isActive: boolean; tripCount: number },
  change: RouteChange,
): 'ROUTE_ARCHIVED' | 'ROUTE_IN_USE' | null {
  if (!state.isActive) return 'ROUTE_ARCHIVED';
  if (change === 'structure' && state.tripCount > 0) return 'ROUTE_IN_USE';
  return null;
}

/** Eine Haltestelle darf auf einer Strecke nur einmal vorkommen (`route_stop` eindeutig). */
export function hasDuplicateStations(stationIds: readonly string[]): boolean {
  return new Set(stationIds).size !== stationIds.length;
}

export function routeStatus(isActive: boolean): RouteStatus {
  return isActive ? 'ACTIVE' : 'ARCHIVED';
}
