import {
  COMPANY_CANCEL_REASONS,
  GENDERS,
  LOCALES,
  normalizeBookingCode,
  normalizeEmail,
  normalizePhone,
} from '@masar/shared';
import { z } from 'zod';

import { normalizeNationalId } from './domain/national-id.js';

/** Personennamen: Unicode-NFC, Leerraum zusammengefasst. Nie im Log (REDACTED_KEYS). */
const personName = z
  .string()
  .transform((value) => value.normalize('NFC').replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(2).max(100));

/**
 * Höchstzahl im Schema. Mehr als 9 Fahrgäste ergeben `TOO_MANY_SEATS` aus dem Service, damit die
 * Oberfläche einen fachlichen Code bekommt statt eines Schemafehlers.
 */
const SCHEMA_MAX_PASSENGERS = 50;

export const createBookingSchema = z
  .object({
    tripId: z.uuid(),
    fromStopId: z.uuid(),
    toStopId: z.uuid(),
    /** Sprache der Benachrichtigungen. */
    locale: z.enum(LOCALES).default('ar'),
    contact: z.object({
      name: personName,
      phone: z
        .string()
        .max(40)
        .transform((value, ctx) => {
          const parsed = normalizePhone(value);
          if (!parsed.ok) {
            ctx.addIssue({ code: 'custom', message: 'Invalid phone number.' });
            return z.NEVER;
          }
          return parsed.e164;
        }),
      email: z
        .string()
        .max(254)
        .transform((value) => normalizeEmail(value))
        .pipe(z.email())
        .optional(),
    }),
    passengers: z
      .array(
        z.object({
          seatId: z.uuid(),
          fullName: personName,
          gender: z.enum(GENDERS).optional(),
          /**
           * Nur gespeichert, wenn die Firma sie verlangt (ADR 0016); sonst verworfen, ohne Fehler,
           * damit eine allgemeine Oberfläche nicht je Firma unterscheiden muss.
           */
          nationalId: z
            .string()
            .max(64)
            .transform((value, ctx) => {
              const normalized = normalizeNationalId(value);
              if (normalized === null) {
                ctx.addIssue({ code: 'custom', message: 'Invalid national ID.' });
                return z.NEVER;
              }
              return normalized;
            })
            .optional(),
        }),
      )
      .min(1)
      .max(SCHEMA_MAX_PASSENGERS),
  })
  .refine(
    (input) => new Set(input.passengers.map((p) => p.seatId)).size === input.passengers.length,
    { path: ['passengers'], message: 'Duplicate seat.' },
  );
export type CreateBookingInput = z.infer<typeof createBookingSchema>;

/**
 * `Idempotency-Key` (API-Konventionen): 16 bis 128 Zeichen aus base64url, also auch eine UUID. Der
 * Schlüssel ist ein Geheimnis des Clients: Wer ihn kennt, bekommt bei Wiederholung ein neues
 * Verwaltungstoken (ADR 0020).
 */
export const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);

/** Verwaltungstoken der Gastbuchung aus dem Header `X-Manage-Token`. */
export const manageTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);

export const bookingIdSchema = z.uuid();

export const lookupBookingSchema = z.object({
  bookingCode: z.string().transform((value, ctx) => {
    const code = normalizeBookingCode(value);
    if (code === null) {
      ctx.addIssue({ code: 'custom', message: 'Invalid booking code.' });
      return z.NEVER;
    }
    return code;
  }),
});
export type LookupBookingInput = z.infer<typeof lookupBookingSchema>;

/**
 * Suche des Fahrgasts nach Code und Telefon (ADR 0009, 0022), nur im POST-Body. Ein Schemafehler
 * verrät nichts über Buchungen; eine passende Form ohne Treffer ergibt `BOOKING_NOT_FOUND`.
 */
export const guestLookupSchema = lookupBookingSchema.extend({
  phone: z
    .string()
    .max(40)
    .transform((value, ctx) => {
      const parsed = normalizePhone(value);
      if (!parsed.ok) {
        ctx.addIssue({ code: 'custom', message: 'Invalid phone number.' });
        return z.NEVER;
      }
      return parsed.e164;
    }),
});
export type GuestLookupInput = z.infer<typeof guestLookupSchema>;

export const companyCancelSchema = z.object({ reason: z.enum(COMPANY_CANCEL_REASONS) });
export type CompanyCancelInput = z.infer<typeof companyCancelSchema>;
