import {
  BOOKING_CHANNELS,
  BOOKING_LIST_LIMITS,
  BOOKING_STATUSES,
  isValidCalendarDate,
  PAYMENT_METHODS,
} from '@masar/shared';
import { z } from 'zod';

import { decodeBookingListCursor, parseBookingSearch } from './domain/booking-list.js';

export const tripIdSchema = z.uuid();

const calendarDate = z.string().refine(isValidCalendarDate, { message: 'Invalid calendar date.' });

/**
 * Buchungsliste der Firma (Schritt 2.5, ADR 0028). `q` sucht nur im Anfang des Buchungscodes und
 * im Ende der Telefonnummer. Eine leere Eingabe zählt als keine Suche; eine unpassende ergibt
 * `null`, und der Service antwortet `BOOKING_SEARCH_INVALID` (fachlicher Code für die Oberfläche).
 */
export const listBookingsQuerySchema = z
  .object({
    tripId: z.uuid().optional(),
    /** Abfahrt der Fahrt am Starthalt, Kalendertage in Damaskus, beide eingeschlossen. */
    from: calendarDate.optional(),
    to: calendarDate.optional(),
    status: z.enum(BOOKING_STATUSES).optional(),
    paymentMethod: z.enum(PAYMENT_METHODS).optional(),
    channel: z.enum(BOOKING_CHANNELS).optional(),
    q: z
      .string()
      .max(BOOKING_LIST_LIMITS.maxQueryLength * 4)
      .optional()
      .transform((value) => {
        if (value === undefined || value.trim() === '') return undefined;
        return parseBookingSearch(value.trim());
      }),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(BOOKING_LIST_LIMITS.maxLimit)
      .default(BOOKING_LIST_LIMITS.defaultLimit),
    cursor: z
      .string()
      .optional()
      .transform((value, ctx) => {
        if (value === undefined) return undefined;
        const cursor = decodeBookingListCursor(value);
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
  });
export type ListBookingsQuery = z.infer<typeof listBookingsQuerySchema>;
