import type { CompanyRole, Locale } from '@masar/shared';

import type { UserSummary } from './api';

export type Membership = UserSummary['memberships'][number];

/**
 * Cookie mit der gewählten Firma (ADR 0025). Enthält nur die Firmen-ID, kein Geheimnis; ob die
 * Person dort Mitglied ist, prüft das Layout bei jedem Aufruf gegen `GET /auth/me`, und die API
 * prüft es bei jedem Aufruf mit `:companyId` noch einmal (`CompanyRoleGuard`).
 */
export const COMPANY_COOKIE = 'masar_portal_company';

/**
 * Firma, in der das Portal arbeitet: die aus dem Cookie, falls die Person dort Mitglied ist, sonst
 * die erste Mitgliedschaft. Ohne Mitgliedschaft (etwa nur Plattform-Admin) `null`.
 */
export function resolveCompany(
  memberships: readonly Membership[],
  selectedId: string | undefined,
): Membership | null {
  return (
    memberships.find((membership) => membership.companyId === selectedId) ?? memberships[0] ?? null
  );
}

export function companyName(
  company: Pick<Membership, 'companyNameAr' | 'companyNameEn'>,
  locale: Locale,
): string {
  return locale === 'ar' ? company.companyNameAr : company.companyNameEn;
}

/** Buchungen sehen und bearbeiten dürfen Admin und Agent (wie `CompanyBookingsController`). */
export function canManageBookings(role: CompanyRole): boolean {
  return role === 'ADMIN' || role === 'AGENT';
}
