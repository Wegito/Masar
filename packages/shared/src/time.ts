import { intlLocale, type Locale } from './locale.js';

/**
 * Zeitzone aller Fahrten. Syrien hat seit 2022 keine Sommerzeit (fest UTC+3), trotzdem wird nie ein
 * Offset hartkodiert, sondern immer die IANA-Zone verwendet (ADR 0012).
 */
export const SYRIA_TIME_ZONE = 'Asia/Damascus';

function toDate(instant: Date | string): Date {
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Ungültiger Zeitpunkt: ${String(instant)}`);
  }
  return date;
}

function formatter(locale: Locale, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(intlLocale(locale), { timeZone: SYRIA_TIME_ZONE, ...options });
}

/** Datum und Uhrzeit in Damaskus, z. B. für Abfahrten: „20 Oct 2026, 23:30". */
export function formatDateTime(instant: Date | string, locale: Locale): string {
  return formatter(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(toDate(instant));
}

/** Datum in Damaskus. `full` enthält den Wochentag, `long` den ausgeschriebenen Monat. */
export function formatDate(
  instant: Date | string,
  locale: Locale,
  style: 'medium' | 'long' | 'full' = 'medium',
): string {
  return formatter(locale, { dateStyle: style }).format(toDate(instant));
}

/** Uhrzeit in Damaskus, 24 Stunden: „23:30". */
export function formatTime(instant: Date | string, locale: Locale): string {
  return formatter(locale, { timeStyle: 'short' }).format(toDate(instant));
}

/**
 * Kalendertag eines Zeitpunkts in Damaskus als `YYYY-MM-DD`.
 * 20:30 UTC ist 23:30 in Damaskus und gehört noch zum selben Tag; 21:30 UTC schon zum nächsten.
 */
export function localDateInDamascus(instant: Date | string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SYRIA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(toDate(instant));
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Prüft einen Kalendertag `YYYY-MM-DD` auf Form und Existenz (kein 30. Februar). */
export function isValidCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const [, year, month, day] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}
