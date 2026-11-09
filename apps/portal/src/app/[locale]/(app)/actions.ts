'use server';

import { cookies } from 'next/headers';

import { COMPANY_COOKIE } from '../../../lib/company';
import { getPortalSession } from '../../../lib/session';

/** Ein Jahr; die Wahl ist eine Vorliebe, keine Berechtigung. */
const MAX_AGE_SECONDS = 365 * 24 * 3600;

/**
 * Firma wechseln (ADR 0025). Gespeichert wird nur eine ID, bei der die Person laut `GET /auth/me`
 * Mitglied ist; eine fremde ID wird stillschweigend ignoriert. Das Setzen des Cookies rendert die
 * aktuelle Seite neu.
 */
export async function selectCompany(formData: FormData): Promise<void> {
  const companyId = formData.get('companyId');
  const session = await getPortalSession();
  if (
    typeof companyId !== 'string' ||
    session === null ||
    !session.user.memberships.some((membership) => membership.companyId === companyId)
  ) {
    return;
  }
  (await cookies()).set(COMPANY_COOKIE, companyId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}
