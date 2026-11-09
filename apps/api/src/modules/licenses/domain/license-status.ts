import {
  LICENSE_PLAN_MONTHS,
  LICENSE_RULES,
  type LicensePlan,
  type LicensePlanningIssue,
  type LicenseStatus,
} from '@masar/shared';

/**
 * Lizenzstand einer Firma (Schritt 2.7, ADR 0029 und 0032) als reine Funktionen ohne Ein- und
 * Ausgabe. Alle Tage sind Kalendertage `YYYY-MM-DD` in Asia/Damascus; der Stichtag kommt vom
 * Aufrufer (`localDateInDamascus(clock.now())`). Zeiträume schließen beide Tage ein.
 */

export interface LicensePeriod {
  id: string;
  plan: LicensePlan;
  validFrom: string;
  /** Letzter gültiger Tag (eingeschlossen). */
  validUntil: string;
  busPackages: number;
}

function utc(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`);
}

function format(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addCalendarDays(day: string, days: number): string {
  const date = new Date(utc(day));
  date.setUTCDate(date.getUTCDate() + days);
  return format(date.getTime());
}

/** Tage von `from` bis `to` (negativ, wenn `to` früher liegt). */
export function daysBetween(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

/**
 * Monate addieren wie PostgreSQL (`date + interval 'n months'`): Gibt es den Tag im Zielmonat
 * nicht, gilt der letzte Tag des Monats (31.08. + 6 Monate = 28.02.). Der Trigger der Migration
 * rechnet genauso; ein Test hält beide gleich.
 */
export function addMonthsClamped(day: string, months: number): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(date, lastDay));
  return format(target.getTime());
}

/** Letzter gültiger Tag eines Plans, der an `validFrom` beginnt (Laufzeit minus ein Tag). */
export function defaultValidUntil(plan: LicensePlan, validFrom: string): string {
  return addCalendarDays(addMonthsClamped(validFrom, LICENSE_PLAN_MONTHS[plan]), -1);
}

/** Erlaubte aktive Busse: 5 je Paket. */
export function allowedBuses(busPackages: number): number {
  return busPackages * LICENSE_RULES.busesPerPackage;
}

export interface LicenseStanding {
  status: LicenseStatus;
  /** Zeitraum, der am Stichtag gilt, sonst der zuletzt abgelaufene; `null` ohne Lizenz. */
  period: LicensePeriod | null;
  /**
   * Letzter Tag, bis zu dem die Firma lückenlos lizenziert ist (der heutige Zeitraum und alle
   * direkt anschließenden); nach Ablauf das Ende des abgelaufenen Zeitraums.
   */
  coveredUntil: string | null;
  /** `coveredUntil` minus Stichtag: 0 am letzten gültigen Tag, negativ in der Kulanz. */
  daysUntilExpiry: number | null;
  /** Letzter Tag der Kulanz (`coveredUntil` + 14). */
  graceEndsOn: string | null;
  /** Nächster Zeitraum nach einer Lücke (bereits eingetragene spätere Verlängerung). */
  upcoming: LicensePeriod | null;
  allowedBuses: number;
  /** Neue Fahrten planen ist erlaubt (gültig oder in der Kulanz). */
  planningAllowed: boolean;
}

function byStart(a: LicensePeriod, b: LicensePeriod): number {
  return a.validFrom < b.validFrom ? -1 : a.validFrom > b.validFrom ? 1 : 0;
}

function warningStatus(daysUntilExpiry: number): LicenseStatus {
  if (daysUntilExpiry <= LICENSE_RULES.urgentDays) return 'EXPIRING_VERY_SOON';
  if (daysUntilExpiry <= LICENSE_RULES.warnDays) return 'EXPIRING_SOON';
  return 'ACTIVE';
}

/**
 * Stand zum Stichtag. Die Zeiträume einer Firma überschneiden sich nicht (EXCLUDE-Constraint);
 * die Funktion verlässt sich darauf nur insofern, als sie den ersten passenden Zeitraum nimmt.
 *
 * - Gilt ein Zeitraum, zählen die Tage bis zum Ende der lückenlosen Kette: Eine schon
 *   eingetragene Verlängerung ab dem Folgetag unterdrückt die Warnung.
 * - Sonst entscheidet der zuletzt abgelaufene Zeitraum: bis Tag 14 nach dem letzten gültigen Tag
 *   `GRACE`, ab Tag 15 `EXPIRED`. Ohne jeden früheren Zeitraum ist die Lizenz `EXPIRED`, auch wenn
 *   ein künftiger eingetragen ist (er gilt erst ab seinem Beginn).
 */
export function licenseStanding(periods: readonly LicensePeriod[], today: string): LicenseStanding {
  const sorted = [...periods].sort(byStart);
  const current = sorted.find((p) => p.validFrom <= today && today <= p.validUntil);
  if (current !== undefined) {
    let coveredUntil = current.validUntil;
    for (const period of sorted) {
      if (period.validFrom === addCalendarDays(coveredUntil, 1)) {
        coveredUntil = period.validUntil;
      }
    }
    const daysUntilExpiry = daysBetween(today, coveredUntil);
    return {
      status: warningStatus(daysUntilExpiry),
      period: current,
      coveredUntil,
      daysUntilExpiry,
      graceEndsOn: addCalendarDays(coveredUntil, LICENSE_RULES.graceDays),
      upcoming: sorted.find((p) => p.validFrom > coveredUntil) ?? null,
      allowedBuses: allowedBuses(current.busPackages),
      planningAllowed: true,
    };
  }
  const upcoming = sorted.find((p) => p.validFrom > today) ?? null;
  const last = sorted.filter((p) => p.validUntil < today).at(-1);
  if (last === undefined) {
    return {
      status: 'EXPIRED',
      period: null,
      coveredUntil: null,
      daysUntilExpiry: null,
      graceEndsOn: null,
      upcoming,
      allowedBuses: 0,
      planningAllowed: false,
    };
  }
  const graceEndsOn = addCalendarDays(last.validUntil, LICENSE_RULES.graceDays);
  const inGrace = today <= graceEndsOn;
  return {
    status: inGrace ? 'GRACE' : 'EXPIRED',
    period: last,
    coveredUntil: last.validUntil,
    daysUntilExpiry: daysBetween(today, last.validUntil),
    graceEndsOn,
    upcoming,
    allowedBuses: allowedBuses(last.busPackages),
    planningAllowed: inGrace,
  };
}

/**
 * Aktive Busse, die das Paket abdeckt: die ältesten zuerst (Anlage, dann ID). Wer mehr aktive
 * Busse hat, als die Pakete erlauben, plant mit den jüngsten keine neuen Fahrten (ADR 0029:
 * Hinweis statt stiller Sperre). Die Reihenfolge ist fest, damit das Portal sie erklären kann.
 */
export function coveredBusIds(
  activeBusIdsOldestFirst: readonly string[],
  allowed: number,
): ReadonlySet<string> {
  return new Set(activeBusIdsOldestFirst.slice(0, Math.max(allowed, 0)));
}

export interface PlanningCheck {
  /** Grund, aus dem das Veröffentlichen abgelehnt wird; die Vorschau zeigt ihn als Warnung. */
  issue: LicensePlanningIssue | null;
  /** Deckt das Paket den gewählten Bus? `null` bei einem Plan ohne Bus. */
  busCovered: boolean | null;
  activeBuses: number;
}

/**
 * Wirkung auf einen Wochenplan: abgelaufene Lizenz (nach der Kulanz) vor der Busgrenze. Ein Plan
 * ohne Bus (nur Sitzplan) prüft keine Busgrenze. Den Status des Busses (`BUS_INACTIVE`) prüft die
 * Fahrtplanung vorher.
 */
export function planningCheck(
  standing: Pick<LicenseStanding, 'planningAllowed' | 'allowedBuses'>,
  activeBusIdsOldestFirst: readonly string[],
  busId: string | null,
): PlanningCheck {
  const busCovered =
    busId === null
      ? null
      : coveredBusIds(activeBusIdsOldestFirst, standing.allowedBuses).has(busId);
  const issue: LicensePlanningIssue | null = !standing.planningAllowed
    ? 'LICENSE_EXPIRED'
    : busCovered === false
      ? 'LICENSE_BUS_LIMIT_EXCEEDED'
      : null;
  return { issue, busCovered, activeBuses: activeBusIdsOldestFirst.length };
}
