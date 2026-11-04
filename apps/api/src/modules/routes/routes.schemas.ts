import {
  CANCELLATION_POLICY_LIMITS,
  CURRENCY_MINOR_DIGITS,
  type Currency,
  isValidCalendarDate,
  ROUTE_LIMITS,
  ROUTE_STATUSES,
} from '@masar/shared';
import { z } from 'zod';

export const routeIdSchema = z.uuid();
export const policyIdSchema = z.uuid();

/** Anzeigename: NFC, Leerraum zusammengefasst. Kein Personenbezug. */
function displayName(max: number): z.ZodType<string, string> {
  return z
    .string()
    .transform((value) => value.normalize('NFC').replace(/\s+/g, ' ').trim())
    .pipe(z.string().min(1).max(max));
}

const CURRENCIES = Object.keys(CURRENCY_MINOR_DIGITS) as [Currency, ...Currency[]];

const calendarDate = z.string().refine(isValidCalendarDate, { message: 'Invalid calendar date.' });

const fareItem = z.object({
  fromSeq: z
    .int()
    .min(0)
    .max(ROUTE_LIMITS.maxStops - 1),
  toSeq: z
    .int()
    .min(1)
    .max(ROUTE_LIMITS.maxStops - 1),
  amountMinor: z.int().positive().max(ROUTE_LIMITS.maxFareMinor),
});

/** Tarifmatrix: alle Teilstrecken in Fahrtrichtung, Positionen `seq` ab 0. */
export const fareMatrixSchema = z.object({
  currency: z.enum(CURRENCIES).default('SYP'),
  items: z.array(fareItem).max((ROUTE_LIMITS.maxStops * (ROUTE_LIMITS.maxStops - 1)) / 2),
});
export type FareMatrixInput = z.infer<typeof fareMatrixSchema>;

/** Neuer Tarifstand ab `validFrom` (Kalendertag in Damaskus, Standard heute). */
export const setFaresSchema = fareMatrixSchema.extend({ validFrom: calendarDate.optional() });
export type SetFaresInput = z.infer<typeof setFaresSchema>;

const stops = z.array(z.uuid()).min(ROUTE_LIMITS.minStops).max(ROUTE_LIMITS.maxStops);

export const createRouteSchema = z.object({
  nameAr: displayName(ROUTE_LIMITS.maxNameLength),
  nameEn: displayName(ROUTE_LIMITS.maxNameLength),
  cancellationPolicyId: z.uuid(),
  /** Haltestellen in Fahrtrichtung. */
  stops,
  fares: fareMatrixSchema,
});
export type CreateRouteInput = z.infer<typeof createRouteSchema>;

export const updateRouteSchema = z
  .object({
    nameAr: displayName(ROUTE_LIMITS.maxNameLength).optional(),
    nameEn: displayName(ROUTE_LIMITS.maxNameLength).optional(),
    cancellationPolicyId: z.uuid().optional(),
  })
  .refine(
    (value) =>
      value.nameAr !== undefined ||
      value.nameEn !== undefined ||
      value.cancellationPolicyId !== undefined,
    { message: 'Nothing to update.' },
  );
export type UpdateRouteInput = z.infer<typeof updateRouteSchema>;

/** Halte ersetzen; die Matrix muss zu den neuen Halten passen und gilt ab heute. */
export const replaceStopsSchema = z.object({ stops, fares: fareMatrixSchema });
export type ReplaceStopsInput = z.infer<typeof replaceStopsSchema>;

export const listRoutesQuerySchema = z.object({
  status: z.enum(ROUTE_STATUSES).optional(),
});
export type ListRoutesQuery = z.infer<typeof listRoutesQuerySchema>;

export const createStationSchema = z.object({
  cityId: z.uuid(),
  nameAr: displayName(ROUTE_LIMITS.maxNameLength),
  nameEn: displayName(ROUTE_LIMITS.maxNameLength),
});
export type CreateStationInput = z.infer<typeof createStationSchema>;

export const createPolicySchema = z.object({
  name: displayName(CANCELLATION_POLICY_LIMITS.maxNameLength),
  allowPassengerCancel: z.boolean().default(true),
  rules: z
    .array(
      z.object({
        minMinutesBeforeDeparture: z
          .int()
          .min(0)
          .max(CANCELLATION_POLICY_LIMITS.maxMinutesBeforeDeparture),
        feeBps: z.int().min(0).max(CANCELLATION_POLICY_LIMITS.maxFeeBps),
      }),
    )
    .max(CANCELLATION_POLICY_LIMITS.maxRules),
});
export type CreatePolicyInput = z.infer<typeof createPolicySchema>;
