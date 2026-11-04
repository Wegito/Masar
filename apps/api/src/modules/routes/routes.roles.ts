import type { CompanyRole } from '@masar/shared';

/**
 * Rollen für Strecken, Haltestellen, Tarife und Stornoregeln (Schritt 2.3), wie bei der Flotte:
 * Lesen dürfen alle, weil Schalter und Fahrer Halte und Preise kennen müssen. Schreiben verändert,
 * was künftige Fahrten verkaufen und kosten, und bleibt dem Admin vorbehalten.
 */
export const ROUTES_READ_ROLES: readonly CompanyRole[] = ['ADMIN', 'AGENT', 'DRIVER'];
export const ROUTES_WRITE_ROLES: readonly CompanyRole[] = ['ADMIN'];
