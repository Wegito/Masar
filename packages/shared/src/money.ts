import { intlLocale, type Locale } from './locale.js';

/**
 * Nachkommastellen je Währung nach ISO 4217. Beträge werden als ganze Zahl in dieser kleinsten
 * Einheit gespeichert (ADR 0011). Für SYP sind das zwei Stellen, obwohl im Alltag nur ganze Pfund
 * vorkommen; die Anzeige zeigt dann keine Nachkommastellen.
 */
export const CURRENCY_MINOR_DIGITS = {
  SYP: 2,
  USD: 2,
  EUR: 2,
} as const satisfies Record<string, number>;

export type Currency = keyof typeof CURRENCY_MINOR_DIGITS;

export interface Money {
  readonly amountMinor: number;
  readonly currency: Currency;
}

export function isCurrency(value: unknown): value is Currency {
  return typeof value === 'string' && Object.hasOwn(CURRENCY_MINOR_DIGITS, value);
}

function minorFactor(currency: Currency): number {
  return 10 ** CURRENCY_MINOR_DIGITS[currency];
}

function assertSafeInteger(value: number, what: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${what} muss eine sichere ganze Zahl sein, war ${value}`);
  }
}

export function money(amountMinor: number, currency: Currency): Money {
  assertSafeInteger(amountMinor, 'amountMinor');
  return { amountMinor, currency };
}

/**
 * Wandelt einen Betrag in Haupteinheiten (z. B. 1500 SYP) in Minor-Units um.
 * Lehnt Beträge mit mehr Nachkommastellen ab, als die Währung hat.
 */
export function fromMajor(major: number, currency: Currency): Money {
  const scaled = major * minorFactor(currency);
  const rounded = Math.round(scaled);
  if (Math.abs(scaled - rounded) > 1e-6) {
    throw new RangeError(`${major} hat zu viele Nachkommastellen für ${currency}`);
  }
  return money(rounded, currency);
}

/** Ganze Haupteinheiten, z. B. Tarife in ganzen SYP. */
export function isWholeMajorUnit(value: Money): boolean {
  return value.amountMinor % minorFactor(value.currency) === 0;
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new TypeError(`Währungen verschieden: ${a.currency} und ${b.currency}`);
  }
  return money(a.amountMinor + b.amountMinor, a.currency);
}

/** Multipliziert mit einer ganzen Zahl, z. B. Tarif mal Anzahl Fahrgäste. */
export function multiplyMoney(value: Money, factor: number): Money {
  assertSafeInteger(factor, 'factor');
  return money(value.amountMinor * factor, value.currency);
}

/** Formatiert für die Anzeige, mit westlichen Ziffern. Nachkommastellen nach CLDR (SYP: keine). */
export function formatMoney(value: Money, locale: Locale): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    style: 'currency',
    currency: value.currency,
  }).format(value.amountMinor / minorFactor(value.currency));
}
