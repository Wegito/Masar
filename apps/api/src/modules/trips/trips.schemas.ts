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

export const seatMapQuerySchema = z.object({
  fromStopId: z.uuid(),
  toStopId: z.uuid(),
  /** Für wen gebucht wird (ADR 0006). Nur ein Filter dieser Anfrage, wird nie gespeichert. */
  gender: z.enum(GENDERS).optional(),
});
export type SeatMapQuery = z.infer<typeof seatMapQuerySchema>;
