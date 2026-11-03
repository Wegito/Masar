import { NextRequest, NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';

import { routing } from './i18n/routing';
import { loginRedirectTarget } from './lib/login-redirect';

const handleI18nRouting = createMiddleware(routing);

/**
 * Strenge Content-Security-Policy mit Nonce je Anfrage (Bedrohungsmodell): Nur Skripte mit diesem
 * Nonce laufen, eingeschleuste Skripte nicht. Next.js liest den Nonce aus dem Anfrage-Header und
 * versieht seine eigenen Skripte damit; die Seiten müssen dafür dynamisch gerendert werden.
 * Beobachtet mit Next 16.4: Next übernimmt den Nonce auch aus dem Antwort-Header. Wir folgen
 * trotzdem dem dokumentierten Weg über den Anfrage-Header.
 */
function contentSecurityPolicy(nonce: string, development: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    // In der Entwicklung fügt Next Styles ohne Nonce ein (laut Next-Doku); in Produktion nur mit Nonce.
    development ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(development ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}

/** Sitzungs-Cookie der API: mit `__Host-` in Produktion (Secure), ohne in der Entwicklung. */
const SESSION_COOKIES = ['__Host-masar_session', 'masar_session'];

export default function proxy(request: NextRequest): NextResponse {
  const target = loginRedirectTarget(
    request.nextUrl.pathname,
    SESSION_COOKIES.some((name) => request.cookies.has(name)),
  );
  if (target !== null) {
    return NextResponse.redirect(new URL(target, request.url));
  }
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
  matcher: '/((?!api|_next|_vercel|.*\\..*).*)',
};
