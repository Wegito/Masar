import { z } from 'zod';

/** NIST SP 800-63B: Länge statt Zeichenklassen. Obergrenze gegen Rechenlast beim Hashen. */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export const newPasswordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

/** Beim Login keine Formatprüfung der E-Mail: jede Abweichung ergibt INVALID_CREDENTIALS. */
export const loginSchema = z.object({
  email: z.string().max(254),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const passwordResetRequestSchema = z.object({ email: z.string().max(254) });
export type PasswordResetRequestInput = z.infer<typeof passwordResetRequestSchema>;

export const passwordResetConfirmSchema = z.object({
  token: z.string().min(20).max(200),
  password: newPasswordSchema,
});
export type PasswordResetConfirmInput = z.infer<typeof passwordResetConfirmSchema>;
