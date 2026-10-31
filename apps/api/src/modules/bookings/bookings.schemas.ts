import { GENDERS, LOCALES, normalizeBookingCode, normalizePhone } from '@masar/shared';
import { z } from 'zod';

/** Telefonnummer wird hier auf E.164 normalisiert; Buchung und spätere Suche nutzen dieselbe Form. */
const phoneSchema = z
  .string()
  .max(40)
  .transform((value, ctx) => {
    const result = normalizePhone(value);
    if (!result.ok) {
      ctx.addIssue({ code: 'custom', message: 'invalid_phone' });
      return z.NEVER;
    }
    return result.e164;
  });

export const createBookingSchema = z.object({
  tripId: z.uuid(),
  fromSeq: z.number().int().min(0).max(100),
  toSeq: z.number().int().min(0).max(100),
  contact: z.object({
    name: z.string().trim().min(1).max(100),
    phone: phoneSchema,
  }),
  locale: z.enum(LOCALES).default('ar'),
  // Obergrenze nur gegen übergroße Anfragen; die fachliche Grenze meldet TOO_MANY_SEATS.
  passengers: z
    .array(
      z.object({
        seatId: z.uuid(),
        fullName: z.string().trim().min(1).max(100),
        gender: z.enum(GENDERS).optional(),
      }),
    )
    .min(1)
    .max(20)
    .refine((list) => new Set(list.map((p) => p.seatId)).size === list.length, {
      message: 'duplicate_seat',
    }),
});
export type CreateBookingInput = z.infer<typeof createBookingSchema>;

/** Vom Client erzeugt, z. B. eine UUID; derselbe Schlüssel bei Wiederholung derselben Anfrage. */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

export const cancelByCompanySchema = z.object({
  reason: z.enum(['PASSENGER_REQUEST', 'TRIP_CHANGED', 'TRIP_CANCELLED', 'DUPLICATE', 'OTHER']),
});
export type CancelByCompanyInput = z.infer<typeof cancelByCompanySchema>;

export const bookingCodeQuerySchema = z.object({
  code: z
    .string()
    .max(20)
    .transform((value, ctx) => {
      const code = normalizeBookingCode(value);
      if (code === null) {
        ctx.addIssue({ code: 'custom', message: 'invalid_code' });
        return z.NEVER;
      }
      return code;
    }),
});
export type BookingCodeQuery = z.infer<typeof bookingCodeQuerySchema>;

export const bookingIdSchema = z.uuid();
