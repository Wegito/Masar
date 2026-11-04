import { GENDERS, isValidCalendarDate } from '@masar/shared';
import { z } from 'zod';

import { FREE_SEATS_DISPLAY_CAP } from './domain/availability.js';
import { decodeSearchCursor } from './domain/search-cursor.js';

/**
 * Höchstzahl Fahrgäste je Suche. Gleich der Kappung freier Sitze: Mehr als „9+" kann die Suche
 * ohnehin nicht zusagen, ohne die Auslastung zu verraten.
 */
export const SEARCH_MAX_PASSENGERS = FREE_SEATS_DISPLAY_CAP;
export const SEARCH_DEFAULT_LIMIT = 20;
export const SEARCH_MAX_LIMIT = 50;

/** Query-Parameter kommen als Strings; Zahlen werden umgewandelt und danach geprüft. */
const queryInt = (min: number, max: number, fallback: number) =>
  z.coerce.number().int().min(min).max(max).default(fallback);

export const tripSearchSchema = z
  .object({
    from: z.uuid(),
    to: z.uuid(),
    date: z.iso.date().refine(isValidCalendarDate),
    passengers: queryInt(1, SEARCH_MAX_PASSENGERS, 1),
    limit: queryInt(1, SEARCH_MAX_LIMIT, SEARCH_DEFAULT_LIMIT),
    cursor: z
      .string()
      .optional()
      .transform((value, ctx) => {
        if (value === undefined) {
          return undefined;
        }
        const cursor = decodeSearchCursor(value);
        if (cursor === null) {
          ctx.addIssue({ code: 'custom', message: 'Invalid cursor.' });
          return z.NEVER;
        }
        return cursor;
      }),
  })
  .refine((query) => query.from !== query.to, { path: ['to'], message: 'Same city.' });
export type TripSearchQuery = z.infer<typeof tripSearchSchema>;

export const tripIdSchema = z.uuid();

/**
 * Body von `POST /trips/:tripId/seat-map` (ADR 0034, löst die Query-Ausnahme aus ADR 0019 ab).
 * `genders` sind die Geschlechter der Fahrgäste dieser Buchung, ohne Zuordnung zu Personen; sie
 * filtern nur diese Anfrage und werden nie gespeichert oder geloggt.
 */
export const seatMapRequestSchema = z.strictObject({
  fromStopId: z.uuid(),
  toStopId: z.uuid(),
  genders: z
    .array(z.enum(GENDERS))
    .max(GENDERS.length)
    .refine((list) => new Set(list).size === list.length, { message: 'Duplicate gender.' })
    .default([]),
});
export type SeatMapRequest = z.infer<typeof seatMapRequestSchema>;
