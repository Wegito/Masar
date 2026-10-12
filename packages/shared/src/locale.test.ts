import { describe, expect, it } from 'vitest';

import { DEFAULT_LOCALE, LOCALES, intlLocale, isLocale, textDirection } from './locale.js';

describe('Sprachen', () => {
  it('Arabisch ist Standard und rechts-nach-links', () => {
    expect(DEFAULT_LOCALE).toBe('ar');
    expect(textDirection('ar')).toBe('rtl');
    expect(textDirection('en')).toBe('ltr');
  });

  it('erkennt nur unterstützte Sprachen', () => {
    expect(isLocale('ar')).toBe(true);
    expect(isLocale('de')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });

  it.each(LOCALES)('%s formatiert mit Region, westlichen Ziffern und 24-Stunden-Uhr', (locale) => {
    const options = new Intl.DateTimeFormat(intlLocale(locale), {
      timeStyle: 'short',
    }).resolvedOptions();
    expect(options.locale).toMatch(locale === 'ar' ? /^ar-SY/ : /^en-GB/);
    expect(options.numberingSystem).toBe('latn');
    expect(options.hourCycle).toBe('h23');
  });
});
