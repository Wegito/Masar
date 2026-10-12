import { DEFAULT_LOCALE, LOCALES } from '@masar/shared';
import { defineRouting } from 'next-intl/routing';

/** Sprache immer im Pfad (/ar/..., /en/...), Arabisch als Standard (ADR 0010). */
export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: 'always',
});
