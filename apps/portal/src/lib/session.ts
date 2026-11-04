// Nur auf dem Server: `next/headers` lässt sich im Browser nicht laden.
import { forwardedClientIp } from '@masar/shared';
import { cookies, headers } from 'next/headers';
import { cache } from 'react';

import type { UserSummary } from './api';
import { COMPANY_COOKIE, type Membership, resolveCompany } from './company';

/** Wie das Rewrite in next.config.ts; in Produktion erreicht das Portal die API intern. */
const API_ORIGIN = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';
const TIMEOUT_MS = 10_000;

export interface PortalSession {
  user: UserSummary;
  /** Gewählte Firma oder `null`, wenn die Person keiner Firma angehört. */
  company: Membership | null;
}

/**
 * Sitzung der aktuellen Anfrage, serverseitig geprüft (ADR 0025): `GET /auth/me` mit dem
 * Cookie-Header des Browsers. `null` heißt „nicht angemeldet" (401). Andere Fehler werfen, damit
 * die Fehlerseite greift statt einer Weiterleitung zum Login. Je Anfrage nur einmal (`cache`).
 * Header, Cookie und Antwort werden nie geloggt.
 */
export const getPortalSession = cache(async (): Promise<PortalSession | null> => {
  const incoming = await headers();
  const cookie = incoming.get('cookie');
  if (cookie === null) {
    return null;
  }
  // Nur eine geprüfte Client-IP, nie der rohe Header (ADR 0033).
  const forwardedFor = forwardedClientIp(incoming.get('x-forwarded-for'));
  const response = await fetch(`${API_ORIGIN}/api/v1/auth/me`, {
    cache: 'no-store',
    headers: {
      cookie,
      accept: 'application/json',
      ...(forwardedFor === null ? {} : { 'x-forwarded-for': forwardedFor }),
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status === 401) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`auth/me antwortete mit ${String(response.status)}`);
  }
  const { user } = (await response.json()) as { user: UserSummary };
  const selected = (await cookies()).get(COMPANY_COOKIE)?.value;
  return { user, company: resolveCompany(user.memberships, selected) };
});
