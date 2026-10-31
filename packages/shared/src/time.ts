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

const LOCAL_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Offset der Zone Damaskus zu UTC in Millisekunden für einen Zeitpunkt (aus den IANA-Daten). */
function damascusOffsetMs(instantMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SYRIA_TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instantMs));
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value);
  const wallAsUtc = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
  return wallAsUtc - Math.floor(instantMs / 1000) * 1000;
}

/**
 * Zeitpunkt einer Wanduhrzeit in Damaskus, z. B. Abfahrt am `2026-10-20` um `23:00`.
 * Der Offset kommt aus der IANA-Zone, nicht aus einer Konstante (ADR 0012). Eine Uhrzeit, die es
 * wegen einer Zeitumstellung nicht gab, landet nach der Umstellung (wie in Intl üblich).
 */
export function instantFromDamascusLocal(date: string, time: string): Date {
  const match = LOCAL_TIME.exec(time);
  if (!isValidCalendarDate(date) || !match) {
    throw new RangeError(`Ungültige Ortszeit: ${date} ${time}`);
  }
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const wallAsUtc = Date.UTC(year, month - 1, day, Number(match[1]), Number(match[2]));
  // Erst mit dem Offset zur Wanduhrzeit schätzen, dann mit dem Offset zum Ergebnis nachrechnen.
  const guess = wallAsUtc - damascusOffsetMs(wallAsUtc);
  return new Date(wallAsUtc - damascusOffsetMs(guess));
}

/** Kalendertag `YYYY-MM-DD` plus `days` Tage (negativ erlaubt). */
export function addDaysToCalendarDate(date: string, days: number): string {
  if (!isValidCalendarDate(date) || !Number.isInteger(days)) {
    throw new RangeError(`Ungültige Angabe: ${date} + ${days}`);
  }
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
