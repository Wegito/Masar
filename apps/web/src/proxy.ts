import createMiddleware from 'next-intl/middleware';

import { routing } from './i18n/routing';

/** Leitet / auf die passende Sprache um (Cookie vor Accept-Language) und setzt das Präfix. */
export default createMiddleware(routing);

export const config = {
  // Nicht für die API (Rewrite auf apps/api), Next-Interna und Dateien mit Endung.
  matcher: '/((?!api|_next|_vercel|.*\\..*).*)',
};
