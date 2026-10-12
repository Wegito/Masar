import { describe, expect, it } from 'vitest';

import { sanitizePath } from './path.js';

describe('sanitizePath', () => {
  it('lässt statische Routen unverändert', () => {
    expect(sanitizePath('/ar/auth/forgot-password')).toBe('/ar/auth/forgot-password');
    expect(sanitizePath('/')).toBe('/');
  });

  it('ersetzt Buchungscodes, auch ohne Ziffern', () => {
    expect(sanitizePath('/ar/t/7KQ2M9XA')).toBe('/ar/t/:param');
    expect(sanitizePath('/en/t/ABCDEFGH')).toBe('/en/t/:param');
  });

  it('ersetzt UUIDs, Zahlen und kodierte Namen', () => {
    expect(sanitizePath('/en/trips/0199f7a4-5c2e-7d3a-9b1e-2f4c6a8d0e12/seats')).toBe(
      '/en/trips/:param/seats',
    );
    expect(sanitizePath('/ar/users/963933123456')).toBe('/ar/users/:param');
    expect(sanitizePath('/ar/%D8%AF%D9%85%D8%B4%D9%82')).toBe('/ar/:param');
  });

  it('entfernt Query und Fragment mit Tokens', () => {
    expect(sanitizePath('/en/auth/reset-password?from=mail#token=abc123')).toBe(
      '/en/auth/reset-password',
    );
    expect(sanitizePath('/en/auth/accept-invitation#token=abc')).toBe('/en/auth/accept-invitation');
  });

  it('ersetzt sehr lange Segmente, auch aus reinen Buchstaben', () => {
    expect(sanitizePath(`/en/${'a'.repeat(41)}`)).toBe('/en/:param');
  });

  it('normalisiert doppelte und abschließende Schrägstriche', () => {
    expect(sanitizePath('en//auth/')).toBe('/en/auth');
  });

  it('kürzt sehr tiefe Pfade und bleibt bei erneutem Aufruf gleich', () => {
    const deep = `/${Array.from({ length: 20 }, () => 'a').join('/')}`;
    const once = sanitizePath(deep);
    expect(once).toBe(`/${Array.from({ length: 12 }, () => 'a').join('/')}/...`);
    expect(sanitizePath(once)).toBe(once);
    expect(sanitizePath('/ar/t/:param')).toBe('/ar/t/:param');
  });
});
