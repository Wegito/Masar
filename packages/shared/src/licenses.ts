/**
 * Lizenzstand je Firma (Schritt 2.7, ADR 0029 und 0032). API und Portal nutzen dieselben Werte.
 * Preise stehen bewusst nicht im System; Rechnungen entstehen außerhalb.
 */

/** Gründungsphase (6 Monate frei), danach 1 oder 2 Jahre. Werte wie der Datenbank-Enum. */
export const LICENSE_PLANS = ['FOUNDING', 'ONE_YEAR', 'TWO_YEARS'] as const;
export type LicensePlan = (typeof LICENSE_PLANS)[number];

/** Laufzeit je Plan in Monaten; der letzte gültige Tag ist der Tag davor. */
export const LICENSE_PLAN_MONTHS: Readonly<Record<LicensePlan, number>> = {
  FOUNDING: 6,
  ONE_YEAR: 12,
  TWO_YEARS: 24,
};

/**
 * Stand zu einem Stichtag in Damaskus. `EXPIRING_SOON` ab 30 Tagen vor dem letzten gültigen Tag,
 * `EXPIRING_VERY_SOON` ab 7, `GRACE` in den 14 Tagen danach (Planen erlaubt), dann `EXPIRED`.
 */
export const LICENSE_STATUSES = [
  'ACTIVE',
  'EXPIRING_SOON',
  'EXPIRING_VERY_SOON',
  'GRACE',
  'EXPIRED',
] as const;
export type LicenseStatus = (typeof LICENSE_STATUSES)[number];

export const LICENSE_RULES = {
  /** Busse je gebuchtem Paket. */
  busesPerPackage: 5,
  /** Kulanztage nach dem letzten gültigen Tag; Tag 14 ist der letzte Tag der Kulanz. */
  graceDays: 14,
  /** Warnung ab so vielen Tagen bis zum letzten gültigen Tag. */
  warnDays: 30,
  /** Deutliche Warnung ab so vielen Tagen. */
  urgentDays: 7,
  /** Obergrenze der Pakete (500 Busse); mehr wäre ein Tippfehler. */
  maxBusPackages: 100,
  /** Höchstlänge der internen Notiz des Plattform-Admins. */
  maxNotesLength: 200,
} as const;

/** Wirkung des Lizenzstands auf das Planen neuer Fahrten. */
export const LICENSE_PLANNING_ISSUES = ['LICENSE_EXPIRED', 'LICENSE_BUS_LIMIT_EXCEEDED'] as const;
export type LicensePlanningIssue = (typeof LICENSE_PLANNING_ISSUES)[number];
