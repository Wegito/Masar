import {
  type CompanyRole,
  CURRENCY_MINOR_DIGITS,
  type Currency,
  formatDate,
  formatMoney,
  isCurrency,
  type Locale,
  money,
  ROUTE_LIMITS,
  type RouteStatus,
} from '@masar/shared';

/** Antworten der Strecken-API (docs/api-konventionen.md, Abschnitt Strecken und Tarife). */

export interface Named {
  id: string;
  nameAr: string;
  nameEn: string;
}

export interface CatalogCity extends Named {
  slug: string;
  stations: (Named & { own: boolean })[];
}

export interface Policy {
  id: string;
  name: string;
  allowPassengerCancel: boolean;
  rules: { minMinutesBeforeDeparture: number; feeBps: number }[];
  routeCount: number;
}

export interface FareEntry {
  fromSeq: number;
  toSeq: number;
  amountMinor: number;
}

export interface FareSet {
  validFrom: string;
  validUntil: string | null;
  currency: string;
  items: FareEntry[];
}

export interface RouteSummary extends Named {
  status: RouteStatus;
  cancellationPolicy: { id: string; name: string };
  stops: { id: string; seq: number; station: Named; city: Named }[];
  tripCount: number;
  editable: boolean;
}

export interface RouteDetail extends RouteSummary {
  fareSets: FareSet[];
}

/** Schreiben dürfen nur Firmen-Admins (wie `ROUTES_WRITE_ROLES` in der API). */
export function canManageRoutes(role: CompanyRole): boolean {
  return role === 'ADMIN';
}

export function localName(value: { nameAr: string; nameEn: string }, locale: Locale): string {
  return locale === 'ar' ? value.nameAr : value.nameEn;
}

/** Schlüssel einer Teilstrecke in der Matrix. */
export function pairKey(fromSeq: number, toSeq: number): string {
  return `${fromSeq}-${toSeq}`;
}

/** Alle Teilstrecken in Fahrtrichtung, wie die API sie verlangt. */
export function farePairs(stopCount: number): [number, number][] {
  const pairs: [number, number][] = [];
  for (let from = 0; from < stopCount; from += 1) {
    for (let to = from + 1; to < stopCount; to += 1) {
      pairs.push([from, to]);
    }
  }
  return pairs;
}

/**
 * Vorschlag für die Matrix aus einem Preis je Abschnitt (Halt i nach i+1): Eine Teilstrecke
 * kostet die Summe ihrer Abschnitte. Fehlt ein Abschnittspreis, bleiben die Felder darüber leer.
 * Ergebnis in Haupteinheiten als Text, wie in den Eingabefeldern.
 */
export function suggestFares(legPrices: readonly string[]): Record<string, string> {
  const legs = legPrices.map(parseMajor);
  const result: Record<string, string> = {};
  for (const [from, to] of farePairs(legs.length + 1)) {
    let sum = 0;
    let complete = true;
    for (let leg = from; leg < to; leg += 1) {
      const value = legs[leg];
      if (value === null || value === undefined) {
        complete = false;
        break;
      }
      sum += value;
    }
    if (complete) {
      result[pairKey(from, to)] = String(sum);
    }
  }
  return result;
}

/** Ganzer positiver Betrag in Haupteinheiten (westliche Ziffern), sonst `null`. */
export function parseMajor(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const amount = Number(trimmed);
  return amount > 0 ? amount : null;
}

export interface FareMatrixDraft {
  items: FareEntry[];
  /** Teilstrecken ohne gültigen Betrag. */
  missing: [number, number][];
}

/**
 * Wandelt die Eingaben der Matrix (ganze Haupteinheiten, z. B. SYP) in Minor-Units. Die
 * verbindliche Prüfung (vollständig, monoton) macht die API; hier nur, was das Formular braucht,
 * um nichts Unvollständiges abzuschicken.
 */
export function fareMatrixDraft(
  stopCount: number,
  values: Readonly<Record<string, string>>,
  currency: Currency,
): FareMatrixDraft {
  const factor = 10 ** CURRENCY_MINOR_DIGITS[currency];
  const items: FareEntry[] = [];
  const missing: [number, number][] = [];
  for (const [fromSeq, toSeq] of farePairs(stopCount)) {
    const major = parseMajor(values[pairKey(fromSeq, toSeq)] ?? '');
    const amountMinor = major === null ? null : major * factor;
    if (amountMinor === null || amountMinor > ROUTE_LIMITS.maxFareMinor) {
      missing.push([fromSeq, toSeq]);
    } else {
      items.push({ fromSeq, toSeq, amountMinor });
    }
  }
  return { items, missing };
}

/** Kalendertag `YYYY-MM-DD` (gemeint in Damaskus) für die Anzeige; Mittag UTC liegt am selben Tag. */
export function formatCalendarDay(day: string, locale: Locale): string {
  return formatDate(`${day}T12:00:00.000Z`, locale);
}

/** Betrag für die Anzeige; unbekannte Währungen ohne Formatierung. */
export function formatFare(amountMinor: number, currency: string, locale: Locale): string {
  return isCurrency(currency)
    ? formatMoney(money(amountMinor, currency), locale)
    : `${amountMinor} ${currency}`;
}

/** Standard-Stornoregel als Vorschlag: ab 24 h kostenlos, ab 2 h 25 %, danach 50 %. */
export const STANDARD_POLICY_RULES = [
  { minMinutesBeforeDeparture: 24 * 60, feeBps: 0 },
  { minMinutesBeforeDeparture: 2 * 60, feeBps: 2_500 },
  { minMinutesBeforeDeparture: 0, feeBps: 5_000 },
] as const;
