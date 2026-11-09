import {
  isValidCalendarDate,
  LICENSE_RULES,
  type LicensePlan,
  type LicensePlanningIssue,
  type LicenseStatus,
} from '@masar/shared';

/** Antworten der Lizenz-API (docs/api-konventionen.md, Abschnitt Lizenz). */

export interface LicensePeriod {
  plan: LicensePlan;
  validFrom: string;
  validUntil: string;
  busPackages: number;
}

export interface LicenseView {
  companyId: string;
  today: string;
  status: LicenseStatus;
  plan: LicensePlan | null;
  validFrom: string | null;
  validUntil: string | null;
  coveredUntil: string | null;
  daysUntilExpiry: number | null;
  graceEndsOn: string | null;
  planningAllowed: boolean;
  busPackages: number;
  allowedBuses: number;
  activeBuses: number;
  busesOverLimit: number;
  upcoming: LicensePeriod | null;
  periods: LicensePeriod[];
}

export interface AdminLicensePeriod extends LicensePeriod {
  id: string;
  notes: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminLicenseView extends Omit<LicenseView, 'periods'> {
  company: { id: string; slug: string; nameAr: string; nameEn: string; status: string };
  periodId: string | null;
  periods: AdminLicensePeriod[];
}

export interface AdminCompanyItem {
  id: string;
  slug: string;
  nameAr: string;
  nameEn: string;
  status: string;
  license: Pick<
    LicenseView,
    | 'status'
    | 'plan'
    | 'validUntil'
    | 'coveredUntil'
    | 'daysUntilExpiry'
    | 'busPackages'
    | 'allowedBuses'
    | 'activeBuses'
  >;
}

/** Teil der Antwort von Vorschau und Veröffentlichung eines Wochenplans. */
export interface ScheduleLicense {
  status: LicenseStatus;
  planningAllowed: boolean;
  coveredUntil: string | null;
  daysUntilExpiry: number | null;
  graceEndsOn: string | null;
  allowedBuses: number;
  activeBuses: number;
  busCovered: boolean | null;
  issue: LicensePlanningIssue | null;
}

/** Tage von `from` bis `to` (Kalendertage `YYYY-MM-DD`). */
export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000,
  );
}

export type LicenseBannerKind = 'expiringSoon' | 'expiringVerySoon' | 'grace' | 'expired';

export interface LicenseBanner {
  kind: LicenseBannerKind;
  /** `warning` (gelb) bei bald ablaufend, `danger` (rot) in der Kulanz und danach. */
  tone: 'warning' | 'danger';
  /** Tage bis zum Ablauf bzw. bis zum Ende der Kulanz (0 = heute ist der letzte Tag). */
  days: number;
  /** Letzter gültiger Tag bzw. letzter Tag der Kulanz. */
  date: string | null;
}

/**
 * Hinweis im Rahmen (ADR 0029: 30 und 7 Tage vor Ablauf, in der Kulanz und danach). Bei `ACTIVE`
 * kein Hinweis. Die Rechnung kommt aus der API; hier wird nur ausgewählt, was zu zeigen ist.
 */
export function licenseBanner(license: LicenseView): LicenseBanner | null {
  switch (license.status) {
    case 'ACTIVE':
      return null;
    case 'EXPIRING_SOON':
    case 'EXPIRING_VERY_SOON':
      return {
        kind: license.status === 'EXPIRING_SOON' ? 'expiringSoon' : 'expiringVerySoon',
        tone: 'warning',
        days: Math.max(license.daysUntilExpiry ?? 0, 0),
        date: license.coveredUntil,
      };
    case 'GRACE':
      return {
        kind: 'grace',
        tone: 'danger',
        days:
          license.graceEndsOn === null
            ? 0
            : Math.max(daysBetween(license.today, license.graceEndsOn), 0),
        date: license.graceEndsOn,
      };
    case 'EXPIRED':
      return { kind: 'expired', tone: 'danger', days: 0, date: license.coveredUntil };
  }
}

export type ScheduleLicenseNotice = 'expired' | 'busLimit' | 'grace' | 'expiring' | null;

/** Was das Formular „Woche planen" zum Lizenzstand der Vorschau zeigt; Sperren gehen vor. */
export function scheduleLicenseNotice(license: ScheduleLicense | undefined): ScheduleLicenseNotice {
  if (license === undefined) return null;
  if (license.issue === 'LICENSE_EXPIRED') return 'expired';
  if (license.issue === 'LICENSE_BUS_LIMIT_EXCEEDED') return 'busLimit';
  if (license.status === 'GRACE') return 'grace';
  if (license.status === 'EXPIRING_SOON' || license.status === 'EXPIRING_VERY_SOON') {
    return 'expiring';
  }
  return null;
}

/** Eingaben im Formular des Plattform-Admins, alle als Text. */
export interface LicenseDraft {
  plan: LicensePlan | '';
  validFrom: string;
  validUntil: string;
  busPackages: string;
  notes: string;
}

export type LicenseDraftField = 'plan' | 'validFrom' | 'validUntil' | 'busPackages' | 'notes';

export type DraftResult<T> = { ok: true; body: T } | { ok: false; field: LicenseDraftField };

function packages(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= 1 && value <= LICENSE_RULES.maxBusPackages ? value : null;
}

function optionalDay(text: string): string | null | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  return isValidCalendarDate(trimmed) ? trimmed : null;
}

/**
 * Body für `POST /admin/companies/:companyId/license` (neuer Zeitraum). Leere Felder bleiben weg;
 * die API ergänzt Beginn (Anschluss oder heute), Ende (Laufzeit des Plans) und Pakete.
 */
export function createLicenseBody(draft: LicenseDraft): DraftResult<Record<string, unknown>> {
  if (draft.plan === '') return { ok: false, field: 'plan' };
  const validFrom = optionalDay(draft.validFrom);
  if (validFrom === null) return { ok: false, field: 'validFrom' };
  const validUntil = optionalDay(draft.validUntil);
  if (validUntil === null) return { ok: false, field: 'validUntil' };
  if (validFrom !== undefined && validUntil !== undefined && validUntil < validFrom) {
    return { ok: false, field: 'validUntil' };
  }
  let busPackages: number | undefined;
  if (draft.busPackages.trim() !== '') {
    const value = packages(draft.busPackages);
    if (value === null) return { ok: false, field: 'busPackages' };
    busPackages = value;
  }
  if (draft.notes.trim().length > LICENSE_RULES.maxNotesLength) {
    return { ok: false, field: 'notes' };
  }
  return {
    ok: true,
    body: {
      plan: draft.plan,
      ...(validFrom === undefined ? {} : { validFrom }),
      ...(validUntil === undefined ? {} : { validUntil }),
      ...(busPackages === undefined ? {} : { busPackages }),
      ...(draft.notes.trim() === '' ? {} : { notes: draft.notes.trim() }),
    },
  };
}

/** Body für `PUT …/license` (heutigen Zeitraum ändern): Pakete, Beginn, Ende und Notiz. */
export function updateLicenseBody(
  draft: Pick<LicenseDraft, 'validFrom' | 'validUntil' | 'busPackages' | 'notes'>,
  current: { validFrom: string; validUntil: string; busPackages: number; notes: string | null },
): DraftResult<Record<string, unknown>> {
  const value = packages(draft.busPackages);
  if (value === null) return { ok: false, field: 'busPackages' };
  const validFrom = draft.validFrom.trim();
  if (!isValidCalendarDate(validFrom)) return { ok: false, field: 'validFrom' };
  const validUntil = draft.validUntil.trim();
  if (!isValidCalendarDate(validUntil) || validUntil < validFrom) {
    return { ok: false, field: 'validUntil' };
  }
  const notes = draft.notes.trim();
  if (notes.length > LICENSE_RULES.maxNotesLength) return { ok: false, field: 'notes' };
  return {
    ok: true,
    body: {
      ...(value === current.busPackages ? {} : { busPackages: value }),
      ...(validFrom === current.validFrom ? {} : { validFrom }),
      ...(validUntil === current.validUntil ? {} : { validUntil }),
      ...(notes === (current.notes ?? '') ? {} : { notes }),
    },
  };
}
