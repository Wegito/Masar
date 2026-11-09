import {
  DEPARTURE_TIME_PATTERN,
  isValidCalendarDate,
  ROUTE_LIMITS,
  TRIP_SCHEDULE_LIMITS,
  TRIP_STATUSES,
} from '@masar/shared';
import { z } from 'zod';

import { decodeTripListCursor } from './domain/trip-list-cursor.js';

export const companyTripIdSchema = z.uuid();

const calendarDate = z.string().refine(isValidCalendarDate, { message: 'Invalid calendar date.' });

/** Zahl der Kalendertage von `from` bis `to`, beide eingeschlossen. */
export function daySpan(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`);
  return Math.round(ms / 86_400_000) + 1;
}

/**
 * Wochenplan (Schritt 2.4, ADR 0027). Genau eines von `busId` und `seatLayoutId`: Mit Bus gilt sein
 * Sitzplan und die Doppelbelegungsprüfung; ohne Bus nur der Sitzplan (Bus später zuweisen).
 */
export const scheduleSchema = z
  .object({
    routeId: z.uuid(),
    busId: z.uuid().optional(),
    seatLayoutId: z.uuid().optional(),
    /** 0 = Sonntag bis 6 = Samstag, jeder Tag höchstens einmal. */
    weekdays: z
      .array(z.int().min(0).max(6))
      .min(1)
      .max(7)
      .refine((days) => new Set(days).size === days.length, { message: 'Duplicate weekday.' }),
    /** Abfahrt am Starthalt, Ortszeit Damaskus, `HH:MM`. */
    departureTime: z.string().regex(DEPARTURE_TIME_PATTERN),
    durationMinutes: z
      .int()
      .min(TRIP_SCHEDULE_LIMITS.minDurationMinutes)
      .max(TRIP_SCHEDULE_LIMITS.maxDurationMinutes),
    /** Erster und letzter Kalendertag (Damaskus), beide eingeschlossen. */
    from: calendarDate,
    to: calendarDate,
    /** Minuten ab Abfahrt je Zwischenhalt; ohne Angabe gleichmäßig verteilt. */
    stopOffsetsMinutes: z
      .array(z.int().min(1).max(TRIP_SCHEDULE_LIMITS.maxDurationMinutes))
      .max(ROUTE_LIMITS.maxStops - 2)
      .optional(),
    /** Sitze im Online-Kontingent (vordere Reihen zuerst); ohne Angabe alle verkaufbaren. */
    onlineSeatCount: z.int().min(0).max(TRIP_SCHEDULE_LIMITS.maxOnlineSeats).optional(),
    /** Geschlechtsregel je Fahrt (ADR 0006); ohne Angabe die Einstellung der Firma. */
    genderRuleEnabled: z.boolean().optional(),
    /** Online-Verkauf endet so viele Minuten vor der Abfahrt; ohne Angabe Firmeneinstellung. */
    onlineSalesCloseMinutes: z
      .int()
      .min(0)
      .max(TRIP_SCHEDULE_LIMITS.maxSalesCloseMinutes)
      .optional(),
  })
  .refine((value) => (value.busId === undefined) !== (value.seatLayoutId === undefined), {
    path: ['busId'],
    message: 'Either busId or seatLayoutId.',
  })
  .refine((value) => value.from <= value.to, { path: ['to'], message: 'Range ends before start.' })
  .refine((value) => daySpan(value.from, value.to) <= TRIP_SCHEDULE_LIMITS.maxDays, {
    path: ['to'],
    message: 'Range too long.',
  });
export type ScheduleInput = z.infer<typeof scheduleSchema>;

export const TRIP_LIST_DEFAULT_DAYS = 14;
export const TRIP_LIST_DEFAULT_LIMIT = 100;
export const TRIP_LIST_MAX_LIMIT = 200;

/** Liste der Fahrten: Zeitraum nach Abfahrt in Damaskus, Strecke, Status, Keyset-Cursor. */
export const listTripsQuerySchema = z
  .object({
    from: calendarDate.optional(),
    to: calendarDate.optional(),
    routeId: z.uuid().optional(),
    status: z.enum(TRIP_STATUSES).optional(),
    limit: z.coerce.number().int().min(1).max(TRIP_LIST_MAX_LIMIT).default(TRIP_LIST_DEFAULT_LIMIT),
    cursor: z
      .string()
      .optional()
      .transform((value, ctx) => {
        if (value === undefined) return undefined;
        const cursor = decodeTripListCursor(value);
        if (cursor === null) {
          ctx.addIssue({ code: 'custom', message: 'Invalid cursor.' });
          return z.NEVER;
        }
        return cursor;
      }),
  })
  .refine((value) => value.from === undefined || value.to === undefined || value.from <= value.to, {
    path: ['to'],
    message: 'Range ends before start.',
  })
  .refine(
    (value) =>
      value.from === undefined ||
      value.to === undefined ||
      daySpan(value.from, value.to) <= TRIP_SCHEDULE_LIMITS.maxDays,
    { path: ['to'], message: 'Range too long.' },
  );
export type ListTripsQuery = z.infer<typeof listTripsQuerySchema>;

/** Kontingent ändern: je Sitz online (`true`) oder Schalter (`false`). */
export const updateQuotaSchema = z.object({
  seats: z
    .array(z.object({ seatId: z.uuid(), onlineSellable: z.boolean() }))
    .min(1)
    .max(TRIP_SCHEDULE_LIMITS.maxOnlineSeats),
});
export type UpdateQuotaInput = z.infer<typeof updateQuotaSchema>;
