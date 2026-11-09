import { isValidCalendarDate } from '@masar/shared';

/**
 * Suchparameter der Seiten (reine Funktionen). Die Werte stehen offen in der URL, damit Ergebnisse
 * teilbar sind und das Formular ohne JavaScript per GET funktioniert. Keine Personendaten: Städte,
 * Tag und Anzahl Fahrgäste. Das Geschlecht steht nie hier (ADR 0019).
 */

/** Höchstzahl Fahrgäste je Suche, gleich der Grenze der API (`SEARCH_MAX_PASSENGERS`). */
export const MAX_PASSENGERS = 9;

/** So viele Tage ab heute bietet die Datumsauswahl an. */
export const DATE_OPTION_DAYS = 30;

/** Opaker Cursor der API; länger ist er nie, längere Werte sind kaputt oder Missbrauch. */
const MAX_CURSOR_LENGTH = 512;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RawParams = Record<string, string | string[] | undefined>;

export interface SearchQuery {
  from: string;
  to: string;
  date: string;
  passengers: number;
  cursor?: string;
}

export type SearchParseResult =
  { ok: true; query: SearchQuery } | { ok: false; reason: 'incomplete' | 'sameCity' | 'invalid' };

export interface SeatPageQuery {
  fromStopId: string;
  toStopId: string;
  passengers: number;
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/** Erster Wert eines Parameters; mehrfach gesetzte Parameter zählen nur einmal. */
export function single(params: RawParams, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

/** Anzahl Fahrgäste 1 bis 9; fehlt der Wert, gilt 1. `null` heißt ungültig. */
export function parsePassengers(value: string | undefined): number | null {
  if (value === undefined || value === '') {
    return 1;
  }
  if (!/^\d{1,2}$/.test(value)) {
    return null;
  }
  const count = Number(value);
  return count >= 1 && count <= MAX_PASSENGERS ? count : null;
}

export function parseSearchQuery(params: RawParams): SearchParseResult {
  const from = single(params, 'from');
  const to = single(params, 'to');
  const date = single(params, 'date');
  const cursor = single(params, 'cursor');
  if (from === undefined || from === '' || to === undefined || to === '' || !date) {
    return { ok: false, reason: 'incomplete' };
  }
  const passengers = parsePassengers(single(params, 'passengers'));
  if (
    !isUuid(from) ||
    !isUuid(to) ||
    !isValidCalendarDate(date) ||
    passengers === null ||
    (cursor !== undefined && (cursor === '' || cursor.length > MAX_CURSOR_LENGTH))
  ) {
    return { ok: false, reason: 'invalid' };
  }
  if (from.toLowerCase() === to.toLowerCase()) {
    return { ok: false, reason: 'sameCity' };
  }
  return {
    ok: true,
    query: { from, to, date, passengers, ...(cursor === undefined ? {} : { cursor }) },
  };
}

export function parseSeatPageQuery(params: RawParams): SeatPageQuery | null {
  const fromStopId = single(params, 'from');
  const toStopId = single(params, 'to');
  const passengers = parsePassengers(single(params, 'passengers'));
  if (!isUuid(fromStopId) || !isUuid(toStopId) || passengers === null) {
    return null;
  }
  return { fromStopId, toStopId, passengers };
}

/** Kalendertag `YYYY-MM-DD` plus n Tage, ohne Zeitzone gerechnet. */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** Tage für die Datumsauswahl, ab heute in Damaskus. */
export function dateOptions(today: string, days = DATE_OPTION_DAYS): string[] {
  return Array.from({ length: days }, (_, offset) => addDays(today, offset));
}

/**
 * Mittag UTC eines Kalendertags. In Damaskus (UTC+3) ist das derselbe Tag; so formatieren die
 * Zeit-Helfer aus `@masar/shared` einen reinen Kalendertag ohne eigenen Offset.
 */
export function calendarDateInstant(date: string): string {
  return `${date}T12:00:00.000Z`;
}

/** Relativer Pfad der Ergebnisseite (ohne Sprachpräfix, den setzt der Link von next-intl). */
export function searchHref(query: SearchQuery): string {
  const params = new URLSearchParams({
    from: query.from,
    to: query.to,
    date: query.date,
    passengers: String(query.passengers),
  });
  if (query.cursor !== undefined) {
    params.set('cursor', query.cursor);
  }
  return `/search?${params.toString()}`;
}

/** Relativer Pfad der Sitzplan-Seite einer Fahrt. */
export function seatPageHref(tripId: string, query: SeatPageQuery): string {
  const params = new URLSearchParams({
    from: query.fromStopId,
    to: query.toStopId,
    passengers: String(query.passengers),
  });
  return `/trips/${encodeURIComponent(tripId)}?${params.toString()}`;
}
