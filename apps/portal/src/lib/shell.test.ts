import { describe, expect, it } from 'vitest';

import ar from '../../messages/ar.json';
import en from '../../messages/en.json';
import { bookingActions, formatTotal } from './booking';
import { canManageBookings, companyName, type Membership, resolveCompany } from './company';
import { loginRedirectTarget } from './login-redirect';
import { isCurrent, NAV_ITEMS, navState } from './nav';

const ARABIC_INDIC_DIGIT = /[٠-٩۰-۹]/;

function membership(companyId: string, role: Membership['role'] = 'ADMIN'): Membership {
  return {
    companyId,
    companySlug: companyId,
    companyNameAr: `شركة ${companyId}`,
    companyNameEn: `Company ${companyId}`,
    role,
  };
}

describe('Firmenkontext', () => {
  const memberships = [membership('a'), membership('b', 'AGENT')];

  it('nimmt die Firma aus dem Cookie, wenn die Person dort Mitglied ist', () => {
    expect(resolveCompany(memberships, 'b')?.companyId).toBe('b');
  });

  it('fällt bei fremder, fehlender oder leerer Wahl auf die erste Mitgliedschaft zurück', () => {
    expect(resolveCompany(memberships, 'fremd')?.companyId).toBe('a');
    expect(resolveCompany(memberships, undefined)?.companyId).toBe('a');
    expect(resolveCompany(memberships, '')?.companyId).toBe('a');
  });

  it('ergibt ohne Mitgliedschaft keine Firma', () => {
    expect(resolveCompany([], 'a')).toBeNull();
  });

  it('zeigt den Namen in der Sprache der Oberfläche', () => {
    expect(companyName(membership('a'), 'ar')).toBe('شركة a');
    expect(companyName(membership('a'), 'en')).toBe('Company a');
  });

  it('erlaubt Buchungen nur Admin und Agent, wie die API', () => {
    expect(canManageBookings('ADMIN')).toBe(true);
    expect(canManageBookings('AGENT')).toBe(true);
    expect(canManageBookings('DRIVER')).toBe(false);
  });
});

describe('Navigation', () => {
  const state = (key: string, role: Membership['role'] | null): string => {
    const item = NAV_ITEMS.find((entry) => entry.key === key);
    if (item === undefined) throw new Error(key);
    return navState(item, role);
  };

  it('hat Start, Flotte, Strecken, Fahrten und Buchungen in dieser Reihenfolge', () => {
    expect(NAV_ITEMS.map((item) => item.key)).toEqual([
      'home',
      'fleet',
      'routes',
      'trips',
      'bookings',
    ]);
  });

  it('verlinkt Start, Flotte, Strecken und Buchungen; Fahrten kommen bald', () => {
    expect(state('home', 'ADMIN')).toBe('enabled');
    expect(state('fleet', 'ADMIN')).toBe('enabled');
    expect(state('routes', 'ADMIN')).toBe('enabled');
    expect(state('routes', 'DRIVER')).toBe('enabled');
    expect(state('bookings', 'AGENT')).toBe('enabled');
    expect(state('trips', 'ADMIN')).toBe('soon');
  });

  it('sperrt Buchungen für Fahrer und Firmenbereiche ohne Firma', () => {
    expect(state('bookings', 'DRIVER')).toBe('forbidden');
    expect(state('fleet', null)).toBe('forbidden');
    expect(state('home', null)).toBe('enabled');
  });

  it('markiert die Startseite nur exakt, Bereiche auch mit Unterseiten', () => {
    expect(isCurrent('/', '/')).toBe(true);
    expect(isCurrent('/', '/bookings')).toBe(false);
    expect(isCurrent('/fleet', '/fleet/buses/1')).toBe(true);
    expect(isCurrent('/fleet', '/fleetwide')).toBe(false);
  });
});

describe('Weiterleitung ohne Sitzung', () => {
  it('schickt Seiten des angemeldeten Bereichs zum Login derselben Sprache', () => {
    expect(loginRedirectTarget('/ar', false)).toBe('/ar/auth/login');
    expect(loginRedirectTarget('/en/', false)).toBe('/en/auth/login');
    expect(loginRedirectTarget('/en/bookings', false)).toBe('/en/auth/login');
    expect(loginRedirectTarget('/ar/fleet/buses', false)).toBe('/ar/auth/login');
  });

  it('lässt Anmeldeseiten, Pfade ohne Sprache und Anfragen mit Sitzung durch', () => {
    expect(loginRedirectTarget('/ar/auth/login', false)).toBeNull();
    expect(loginRedirectTarget('/en/auth/reset-password', false)).toBeNull();
    expect(loginRedirectTarget('/', false)).toBeNull();
    expect(loginRedirectTarget('/de/bookings', false)).toBeNull();
    expect(loginRedirectTarget('/en/bookings', true)).toBeNull();
  });
});

describe('Buchungen am Schalter', () => {
  it('bestätigt bar nur Barreservierungen und storniert nur aktive Buchungen', () => {
    expect(bookingActions('RESERVED')).toEqual({ confirmCash: true, cancel: true });
    expect(bookingActions('HELD')).toEqual({ confirmCash: false, cancel: true });
    expect(bookingActions('CONFIRMED')).toEqual({ confirmCash: false, cancel: true });
    expect(bookingActions('CANCELLED')).toEqual({ confirmCash: false, cancel: false });
    expect(bookingActions('EXPIRED')).toEqual({ confirmCash: false, cancel: false });
  });

  it('formatiert den Betrag aus Minor-Units mit westlichen Ziffern', () => {
    const total = { amountMinor: 120_000, currency: 'SYP' };
    expect(formatTotal(total, 'en').replace(/\s/g, ' ')).toBe('SYP 1,200');
    expect(formatTotal(total, 'ar')).not.toMatch(ARABIC_INDIC_DIGIT);
    expect(formatTotal({ amountMinor: 5, currency: 'XXX' }, 'en')).toBe('5 XXX');
  });
});

describe('Texte', () => {
  function keys(value: unknown, prefix = ''): string[] {
    if (typeof value !== 'object' || value === null) return [prefix];
    return Object.entries(value).flatMap(([key, child]) =>
      keys(child, prefix === '' ? key : `${prefix}.${key}`),
    );
  }

  it('haben in ar und en dieselben Schlüssel', () => {
    expect(keys(ar).sort()).toEqual(keys(en).sort());
  });
});
