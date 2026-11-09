import type { CompanyRole } from '@masar/shared';

/**
 * Rollen der Fahrtplanung (Schritt 2.4), wie Flotte und Strecken: Lesen dürfen alle, weil Schalter
 * und Fahrer die Fahrten des Tages kennen müssen. Planen, Absagen und das Kontingent ändern bleiben
 * dem Admin vorbehalten.
 */
export const TRIPS_READ_ROLES: readonly CompanyRole[] = ['ADMIN', 'AGENT', 'DRIVER'];
export const TRIPS_WRITE_ROLES: readonly CompanyRole[] = ['ADMIN'];
