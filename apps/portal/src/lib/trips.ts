import {
  type CompanyRole,
  DEPARTURE_TIME_PATTERN,
  formatDate,
  formatTime,
  intlLocale,
  isValidCalendarDate,
  type Locale,
  type ScheduleItemState,
  type SeatSide,
  TRIP_SCHEDULE_LIMITS,
  type TripStatus,
} from '@masar/shared';

import type { ScheduleLicense } from './license';

/** Antworten der Fahrtplanungs-API (docs/api-konventionen.md, Abschnitt Fahrtplanung). */

export interface TripQuota {
  total: number;
  online: number;
  counter: number;
  blocked: number;
  occupied: number;
}

export interface TripSummary {
  id: string;
  status: TripStatus;
  serviceDate: string;
  departureAt: string;
  arrivalAt: string;
  onlineSalesCloseAt: string;
  genderRuleEnabled: boolean;
  route: { id: string; nameAr: string; nameEn: string };
  bus: { id: string; plate: string } | null;
  seatLayout: { id: string; name: string; version: number };
  quota: TripQuota;
  activeBookings: number;
}

export interface TripSeat {
  seatId: string;
  label: string;
  row: number;
  column: number;
  side: SeatSide;
  isSellable: boolean;
  onlineSellable: boolean;
  blocked: boolean;
  occupied: boolean;
}

export interface TripDetail extends TripSummary {
  stops: {
    id: string;
    seq: number;
    arrivalAt: string | null;
    departureAt: string | null;
    station: { id: string; nameAr: string; nameEn: string };
    city: { id: string; nameAr: string; nameEn: string };
  }[];
  layout: { rows: number; columns: number };
  seats: TripSeat[];
}

export interface ScheduleItem {
  serviceDate: string;
  departureAt: string;
  arrivalAt: string;
  state: ScheduleItemState;
  tripId: string | null;
  fareMissing: boolean;
  stops: { seq: number; arrivalAt: string | null; departureAt: string | null }[];
}

export interface ScheduleResult {
  busId: string | null;
  seatLayoutId: string;
  seatCount: number;
  onlineSeats: number;
  genderRuleEnabled: boolean;
  onlineSalesCloseMinutes: number;
  stopOffsetsMinutes: number[];
  items: ScheduleItem[];
  summary: {
    total: number;
    new: number;
    existing: number;
    busConflicts: number;
    fareMissingDates: string[];
  };
  /** Wirkung des Lizenzstands (Schritt 2.7); `issue` sperrt das Veröffentlichen. */
  license: ScheduleLicense;
}

/** Planen, absagen und das Kontingent ändern dürfen nur Admins (wie `TRIPS_WRITE_ROLES`). */
export function canManageTrips(role: CompanyRole): boolean {
  return role === 'ADMIN';
}

/** Kalendertag `YYYY-MM-DD` plus `days` Tage. */
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Heutiger Kalendertag in Damaskus. */
export function todayInDamascus(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Damascus' }).format(now);
}

/** Name des Wochentags (0 = Sonntag) in der Sprache der Oberfläche; 1970-01-04 war ein Sonntag. */
export function weekdayName(weekday: number, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(1970, 0, 4 + weekday)),
  );
}

/** Tag und Uhrzeit einer Abfahrt in Damaskus, mit Wochentag: „Thu, 5 Nov 2026 · 07:00". */
export function formatDeparture(iso: string, locale: Locale): string {
  return `${formatDate(iso, locale, 'full')} · ${formatTime(iso, locale)}`;
}

export interface ScheduleDraft {
  routeId: string;
  /** Bus (`bus:<id>`) oder nur Sitzplan (`layout:<id>`), wie im Auswahlfeld. */
  vehicle: string;
  weekdays: readonly number[];
  departureTime: string;
  durationHours: string;
  durationMinutes: string;
  from: string;
  to: string;
  /** Leer: alle Sitze online. */
  onlineSeats: string;
  /** `company`, `on` oder `off`. */
  genderRule: string;
  /** Leer: Einstellung der Firma. */
  salesCloseMinutes: string;
}

export type DraftField =
  | 'routeId'
  | 'vehicle'
  | 'weekdays'
  | 'departureTime'
  | 'duration'
  | 'range'
  | 'onlineSeats'
  | 'salesCloseMinutes';

export type ScheduleBody = Record<string, unknown>;

function wholeNumber(value: string): number | null {
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

/**
 * Baut aus dem Formular den Body für Vorschau und Veröffentlichung. Prüft nur, was das Formular
 * braucht, um nichts Unvollständiges abzuschicken; verbindlich prüft die API (dieselben Grenzen
 * aus `TRIP_SCHEDULE_LIMITS`).
 */
export function scheduleBody(
  draft: ScheduleDraft,
): { ok: true; body: ScheduleBody } | { ok: false; field: DraftField } {
  if (draft.routeId === '') return { ok: false, field: 'routeId' };
  const [kind, id] = draft.vehicle.split(':');
  if ((kind !== 'bus' && kind !== 'layout') || id === undefined || id === '') {
    return { ok: false, field: 'vehicle' };
  }
  if (draft.weekdays.length === 0) return { ok: false, field: 'weekdays' };
  if (!DEPARTURE_TIME_PATTERN.test(draft.departureTime.trim())) {
    return { ok: false, field: 'departureTime' };
  }
  const hours = wholeNumber(draft.durationHours === '' ? '0' : draft.durationHours);
  const minutes = wholeNumber(draft.durationMinutes === '' ? '0' : draft.durationMinutes);
  const duration = hours === null || minutes === null ? null : hours * 60 + minutes;
  if (
    duration === null ||
    duration < TRIP_SCHEDULE_LIMITS.minDurationMinutes ||
    duration > TRIP_SCHEDULE_LIMITS.maxDurationMinutes
  ) {
    return { ok: false, field: 'duration' };
  }
  const from = draft.from.trim();
  const to = draft.to.trim();
  if (!isValidCalendarDate(from) || !isValidCalendarDate(to) || to < from) {
    return { ok: false, field: 'range' };
  }
  if (addDays(from, TRIP_SCHEDULE_LIMITS.maxDays - 1) < to) {
    return { ok: false, field: 'range' };
  }
  const body: ScheduleBody = {
    routeId: draft.routeId,
    ...(kind === 'bus' ? { busId: id } : { seatLayoutId: id }),
    weekdays: [...draft.weekdays].sort((a, b) => a - b),
    departureTime: draft.departureTime.trim(),
    durationMinutes: duration,
    from,
    to,
  };
  if (draft.onlineSeats.trim() !== '') {
    const online = wholeNumber(draft.onlineSeats);
    if (online === null || online > TRIP_SCHEDULE_LIMITS.maxOnlineSeats) {
      return { ok: false, field: 'onlineSeats' };
    }
    body.onlineSeatCount = online;
  }
  if (draft.genderRule === 'on' || draft.genderRule === 'off') {
    body.genderRuleEnabled = draft.genderRule === 'on';
  }
  if (draft.salesCloseMinutes.trim() !== '') {
    const close = wholeNumber(draft.salesCloseMinutes);
    if (close === null || close > TRIP_SCHEDULE_LIMITS.maxSalesCloseMinutes) {
      return { ok: false, field: 'salesCloseMinutes' };
    }
    body.onlineSalesCloseMinutes = close;
  }
  return { ok: true, body };
}

export type SeatQuotaState = 'ONLINE' | 'COUNTER' | 'BLOCKED';

/** Kanal eines Sitzes für die Anzeige; gesperrt und nicht verkaufbar gehen vor. */
export function seatQuotaState(seat: TripSeat): SeatQuotaState {
  if (seat.blocked || !seat.isSellable) return 'BLOCKED';
  return seat.onlineSellable ? 'ONLINE' : 'COUNTER';
}

/** Fahrten, die abgesagt werden können (wie der Automat in der API). */
export function canCancelTrip(trip: Pick<TripSummary, 'status'>): boolean {
  return trip.status === 'SCHEDULED';
}
