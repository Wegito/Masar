import { COMPANY_ROLES, LOCALES } from '@masar/shared';
import { z } from 'zod';

import { newPasswordSchema } from '../auth/auth.schemas.js';

export const createInvitationSchema = z.object({
  email: z.email().max(254),
  role: z.enum(COMPANY_ROLES),
  /** Sprache der E-Mail und Startsprache des neuen Kontos. */
  locale: z.enum(LOCALES).optional(),
});
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

/** Neue Konten brauchen Name und Passwort; bestehende Konten nehmen angemeldet an. */
export const acceptInvitationSchema = z.object({
  token: z.string().min(20).max(200),
  displayName: z.string().trim().min(1).max(100).optional(),
  password: newPasswordSchema.optional(),
});
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
