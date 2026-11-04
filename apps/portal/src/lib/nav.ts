import type { CompanyRole } from '@masar/shared';

import { canManageBookings } from './company';

export type NavKey =
  'home' | 'fleet' | 'routes' | 'trips' | 'bookings' | 'counter' | 'license' | 'admin';

export interface NavItem {
  key: NavKey;
  /** Pfad ohne Sprachpräfix; `null`, solange es die Seite noch nicht gibt. */
  href: string | null;
  /** Rolle, die den Eintrag sehen darf; ohne Angabe alle Mitglieder. */
  allowed?: (role: CompanyRole) => boolean;
  /** Nur für Plattform-Admins sichtbar, unabhängig von einer Firma; sonst ausgeblendet. */
  platformAdminOnly?: boolean;
}

/**
 * Einträge der Seitennavigation in fester Reihenfolge (Roadmap Phase 2). Seiten, die es noch nicht
 * gibt, stehen deaktiviert mit „bald" in der Liste, damit die Struktur des Portals von Anfang an
 * sichtbar ist. Strecken (2.3) und Fahrten (2.4) lesen alle Rollen, wie die Flotte.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { key: 'home', href: '/' },
  { key: 'fleet', href: '/fleet' },
  { key: 'routes', href: '/routes' },
  { key: 'trips', href: '/trips' },
  { key: 'bookings', href: '/bookings', allowed: canManageBookings },
  // Schalter (2.6): verkaufen dürfen Admin und Agent, wie die API (`CounterController`).
  { key: 'counter', href: '/counter', allowed: canManageBookings },
  // Lizenz (2.7): lesen dürfen alle Rollen der Firma, wie die API.
  { key: 'license', href: '/license' },
  // Plattform-Verwaltung (2.7, ADR 0032): nur Plattform-Admins, für alle anderen ausgeblendet.
  { key: 'admin', href: '/admin/companies', platformAdminOnly: true },
];

export type NavState = 'enabled' | 'soon' | 'forbidden' | 'hidden';

/**
 * Zustand eines Eintrags für die Rolle in der aktuellen Firma (`null`: keine Firma). Einträge nur
 * für Plattform-Admins sind für alle anderen `hidden`, nicht „kein Zugriff".
 */
export function navState(
  item: NavItem,
  role: CompanyRole | null,
  isPlatformAdmin = false,
): NavState {
  if (item.platformAdminOnly === true) {
    return isPlatformAdmin ? 'enabled' : 'hidden';
  }
  if (item.href === null) {
    return 'soon';
  }
  if (item.key === 'home') {
    return 'enabled';
  }
  if (role === null || (item.allowed !== undefined && !item.allowed(role))) {
    return 'forbidden';
  }
  return 'enabled';
}

/** Ist der Eintrag die aktuelle Seite? Die Startseite nur exakt, andere auch mit Unterseiten. */
export function isCurrent(href: string, pathname: string): boolean {
  if (href === '/') {
    return pathname === '/';
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
