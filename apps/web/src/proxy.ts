import { NextRequest, type NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';

import { routing } from './i18n/routing';

const handleI18nRouting = createMiddleware(routing);

/**
 * Strenge Content-Security-Policy mit Nonce je Anfrage, wie im Portal (Bedrohungsmodell). Seit Suche
 * und Sitzplan (Schritt 1.5) rendert die Fahrgast-App ohnehin jede Seite dynamisch; der Nonce kostet
 * deshalb kein statisches Vorrendern mehr (docs/web-fahrgastablauf.md). Next.js liest den Nonce aus
 * dem Anfrage-Header und versieht seine Skripte damit. Keine Inline-Styles in den Komponenten.
 */
function contentSecurityPolicy(nonce: string, development: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    // In der Entwicklung fügt Next Styles ohne Nonce ein (laut Next-Doku); in Produktion nur mit Nonce.
    development ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data: blob:",
    // Service Worker der Ticketseite (public/sw.js, ADR 0022); mit 'strict-dynamic' gilt 'self'
    // aus script-src nicht für Worker.
    "worker-src 'self'",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(development ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}

/** Leitet / auf die passende Sprache um (Cookie vor Accept-Language), setzt das Präfix und die CSP. */
export default function proxy(request: NextRequest): NextResponse {
  const nonce = btoa(crypto.randomUUID());
  const policy = contentSecurityPolicy(nonce, process.env.NODE_ENV === 'development');
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', policy);
  // next-intl übernimmt die Anfrage-Header in seine Antwort; so erreicht der Nonce das Rendern.
  const response = handleI18nRouting(new NextRequest(request, { headers }));
  response.headers.set('Content-Security-Policy', policy);
  return response;
}

export const config = {
  // Nicht für die API (Rewrite auf apps/api), Next-Interna und Dateien mit Endung.
  matcher: '/((?!api|_next|_vercel|.*\\..*).*)',
};
