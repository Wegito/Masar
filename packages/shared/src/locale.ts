/** Sprachen der Oberfläche. Arabisch ist Standard. */
export const LOCALES = ['ar', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'ar';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

export function textDirection(locale: Locale): 'rtl' | 'ltr' {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

/**
 * BCP-47-Locale für Intl-Formatierung.
 *
 * - `ar-SY`: nur mit Region SY erscheinen die levantinischen Monatsnamen (كانون الثاني statt يناير).
 * - `en-GB`: Tag vor Monat, wie in Syrien üblich.
 * - `nu-latn`: westliche Ziffern in beiden Sprachen; Codes und Preise werden am Schalter abgetippt.
 * - `hc-h23`: 24-Stunden-Uhr, eindeutig bei Nachtfahrten (Annahme, siehe offene Entscheidungen).
 */
const INTL_LOCALES: Record<Locale, string> = {
  ar: 'ar-SY-u-hc-h23-nu-latn',
  en: 'en-GB-u-hc-h23-nu-latn',
};

export function intlLocale(locale: Locale): string {
  return INTL_LOCALES[locale];
}
