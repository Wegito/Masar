import type { CompanyRole } from '@masar/shared';

/**
 * Rollen der Flotte (Schritt 2.2). Die Firma kennt `ADMIN`, `AGENT` und `DRIVER`; eine eigene
 * Managerrolle gibt es nicht. Lesen dürfen alle, weil Schalter und Fahrer Bus und Sitzplan sehen
 * müssen. Schreiben verändert, was künftige Fahrten verkaufen, und bleibt dem Admin vorbehalten.
 */
export const FLEET_READ_ROLES: readonly CompanyRole[] = ['ADMIN', 'AGENT', 'DRIVER'];
export const FLEET_WRITE_ROLES: readonly CompanyRole[] = ['ADMIN'];
