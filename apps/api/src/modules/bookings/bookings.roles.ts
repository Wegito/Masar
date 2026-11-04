import type { CompanyRole } from '@masar/shared';

/**
 * Rollen der Buchungen im Portal (Schritt 2.5, ADR 0028). Buchungen lesen und bearbeiten Admin und
 * Agent; Fahrer bestätigen erst mit dem Scan (Phase 4). Die Fahrgastliste einer Fahrt sehen auch
 * Fahrer, weil sie beim Einsteigen Namen, Sitz und Halt brauchen, aber ohne Kontaktdaten und
 * Buchungscodes. Eine Zuordnung Fahrer → Fahrt gibt es noch nicht: Ein Fahrer sieht die Listen
 * aller Fahrten seiner Firma.
 */
export const BOOKINGS_STAFF_ROLES: readonly CompanyRole[] = ['ADMIN', 'AGENT'];
export const TRIP_PASSENGERS_ROLES: readonly CompanyRole[] = ['ADMIN', 'AGENT', 'DRIVER'];
