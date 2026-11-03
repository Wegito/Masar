import {
  GENERATED_SEAT_LAYOUT_PATTERNS,
  SEAT_LAYOUT_LIMITS,
  SEAT_LAYOUT_STATUSES,
} from '@masar/shared';
import { z } from 'zod';

import { normalizePlate } from './domain/plate.js';

export const layoutIdSchema = z.uuid();
export const busIdSchema = z.uuid();

/** Name eines Sitzplans: NFC, Leerraum zusammengefasst. Kein Personenbezug, frei wählbar. */
const layoutName = z
  .string()
  .transform((value) => value.normalize('NFC').replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(1).max(SEAT_LAYOUT_LIMITS.maxNameLength));

/** Eingabe des Generators: Muster, reguläre Reihen und optional eine Hinterbank. */
export const layoutSpecSchema = z.object({
  pattern: z.enum(GENERATED_SEAT_LAYOUT_PATTERNS),
  rows: z.int().min(SEAT_LAYOUT_LIMITS.minRows).max(SEAT_LAYOUT_LIMITS.maxRows),
  backBench: z
    .int()
    .min(SEAT_LAYOUT_LIMITS.minBackBench)
    .max(SEAT_LAYOUT_LIMITS.maxBackBench)
    .optional(),
});
export type LayoutSpecInput = z.infer<typeof layoutSpecSchema>;

export const createLayoutSchema = layoutSpecSchema.extend({ name: layoutName });
export type CreateLayoutInput = z.infer<typeof createLayoutSchema>;

export const listLayoutsQuerySchema = z.object({
  status: z.enum(SEAT_LAYOUT_STATUSES).optional(),
});
export type ListLayoutsQuery = z.infer<typeof listLayoutsQuerySchema>;

const plate = z
  .string()
  .max(100)
  .transform((value, ctx) => {
    const normalized = normalizePlate(value);
    if (normalized === null) {
      ctx.addIssue({ code: 'custom', message: 'Invalid plate.' });
      return z.NEVER;
    }
    return normalized;
  });

export const createBusSchema = z.object({
  plate,
  seatLayoutId: z.uuid(),
});
export type CreateBusInput = z.infer<typeof createBusSchema>;

export const updateBusSchema = z
  .object({
    plate: plate.optional(),
    seatLayoutId: z.uuid().optional(),
  })
  .refine((value) => value.plate !== undefined || value.seatLayoutId !== undefined, {
    message: 'Nothing to update.',
  });
export type UpdateBusInput = z.infer<typeof updateBusSchema>;
