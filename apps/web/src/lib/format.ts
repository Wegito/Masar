import {
  formatMoney,
  isCurrency,
  type Locale,
  localDateInDamascus,
  multiplyMoney,
} from '@masar/shared';

import type { MoneyView, Named } from './types';

/**
 * Anzeige-Helfer der Fahrgast-App (reine Funktionen). Zahlen, Zeiten und Beträge kommen über die
 * Helfer aus `@masar/shared`: westliche Ziffern, 24 Stunden, Zone Asia/Damascus (ADR 0010, 0012).
 */

export function localizedName(value: Named, locale: Locale): string {
  return locale === 'ar' ? value.nameAr : value.nameEn;
}

/**
 * Betrag in Minor-Units, optional mal Anzahl Fahrgäste. Unbekannte Währungen (die API liefert den
 * Code als Text) erscheinen nüchtern als Zahl mit Code statt als Absturz.
 */
export function formatFare(fare: MoneyView, locale: Locale, factor = 1): string {
  if (!isCurrency(fare.currency) || !Number.isSafeInteger(fare.amountMinor)) {
    return `${String(fare.amountMinor * factor)} ${fare.currency}`;
  }
  return formatMoney(
    multiplyMoney({ amountMinor: fare.amountMinor, currency: fare.currency }, factor),
    locale,
  );
}

/** Freie Sitze wie in der API gekappt: „9+" heißt mindestens neun (ADR 0007). */
export function freeSeatsLabel(freeSeats: { count: number; capped: boolean }): string {
  return freeSeats.capped ? `${String(freeSeats.count)}+` : String(freeSeats.count);
}

/** Wie viele Kalendertage in Damaskus liegen zwischen Abfahrt und Ankunft (Nachtfahrt: 1). */
export function arrivalDayOffset(departureAt: string, arrivalAt: string | null): number {
  if (arrivalAt === null) {
    return 0;
  }
  const day = (instant: string): number =>
    Date.parse(`${localDateInDamascus(instant)}T00:00:00.000Z`);
  return Math.round((day(arrivalAt) - day(departureAt)) / 86_400_000);
}
