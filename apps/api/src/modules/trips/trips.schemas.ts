import { GENDERS, isValidCalendarDate } from '@masar/shared';
import { z } from 'zod';

const citySlug = z.string().regex(/^[a-z0-9-]{1,64}$/);

export const tripSearchSchema = z
  .object({
    from: citySlug,
    to: citySlug,
    /** Suchtag `YYYY-MM-DD`, gemeint in Damaskus. */
    date: z.string().refine(isValidCalendarDate),
  })
  .refine((query) => query.from !== query.to, { path: ['to'], message: 'same_city' });
export type TripSearchQuery = z.infer<typeof tripSearchSchema>;

const seq = z.coerce.number().int().min(0).max(100);

export const seatMapSchema = z.object({
  fromSeq: seq,
  toSeq: seq,
  /** Für wen gebucht wird; Pflicht, wenn die Fahrt die Geschlechtsregel hat (ADR 0006). */
  gender: z.enum(GENDERS).optional(),
});
export type SeatMapQuery = z.infer<typeof seatMapSchema>;

export const tripIdSchema = z.uuid();
