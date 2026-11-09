import { isLocale } from '@masar/shared';

/**
 * Ziel der Weiterleitung, wenn ein Pfad des angemeldeten Bereichs ohne Sitzungs-Cookie kommt
 * (ADR 0025). Nur eine optimistische Vorprüfung ohne API-Aufruf, weil der Proxy auch bei jedem
 * Vorabladen läuft; ob die Sitzung gültig ist, prüft das Layout `(app)` über `GET /auth/me`.
 * Anmeldeseiten unter `/{locale}/auth/` sind frei, Pfade ohne Sprachpräfix leitet next-intl um.
 */
export function loginRedirectTarget(pathname: string, hasSession: boolean): string | null {
  if (hasSession) {
    return null;
  }
  const [, first = '', ...rest] = pathname.split('/');
  if (!isLocale(first) || rest[0] === 'auth') {
    return null;
  }
  return `/${first}/auth/login`;
}
