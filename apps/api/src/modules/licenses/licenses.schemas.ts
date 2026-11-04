import { isValidCalendarDate, LICENSE_PLANS, LICENSE_RULES } from '@masar/shared';
import { z } from 'zod';

const calendarDate = z.string().refine(isValidCalendarDate, { message: 'Invalid calendar date.' });
const busPackages = z.int().min(1).max(LICENSE_RULES.maxBusPackages);
/**
 * Interne Notiz des Plattform-Admins (etwa eine Rechnungsnummer). Ohne Personendaten: Sie steht
 * nicht im Audit-Log und nie in Logs, die Firma sieht sie nicht. Leer zählt als „keine Notiz".
 */
const notes = z
  .string()
  .trim()
  .max(LICENSE_RULES.maxNotesLength)
  .transform((value) => (value === '' ? null : value));

/**
 * Neuer Lizenzzeitraum (setzen oder verlängern). Ohne `validFrom` schließt er an den laufenden
 * oder in der Kulanz liegenden Zeitraum an, sonst beginnt er heute (Damaskus). Ohne `validUntil`
 * gilt die Laufzeit des Plans; ohne `busPackages` die Pakete des letzten Zeitraums.
 */
export const createLicenseSchema = z.object({
  plan: z.enum(LICENSE_PLANS),
  validFrom: calendarDate.optional(),
  validUntil: calendarDate.optional(),
  busPackages: busPackages.optional(),
  notes: notes.optional(),
});
export type CreateLicenseInput = z.infer<typeof createLicenseSchema>;

/**
 * Zeitraum ändern oder korrigieren (Pakete, Beginn, Ende, Plan, Notiz). Ohne `periodId` der
 * Zeitraum, der heute gilt, sonst der zuletzt abgelaufene; mit `periodId` genau dieser (auch ein
 * künftiger). Überschneidungen verhindert das EXCLUDE-Constraint (`LICENSE_PERIOD_OVERLAP`).
 */
export const updateLicenseSchema = z
  .object({
    periodId: z.uuid().optional(),
    plan: z.enum(LICENSE_PLANS).optional(),
    validFrom: calendarDate.optional(),
    validUntil: calendarDate.optional(),
    busPackages: busPackages.optional(),
    notes: notes.nullable().optional(),
  })
  .refine(
    (body) =>
      body.plan !== undefined ||
      body.validFrom !== undefined ||
      body.validUntil !== undefined ||
      body.busPackages !== undefined ||
      body.notes !== undefined,
    { message: 'Nothing to change.', path: ['busPackages'] },
  );
export type UpdateLicenseInput = z.infer<typeof updateLicenseSchema>;
