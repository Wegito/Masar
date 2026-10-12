import { z } from 'zod';

/**
 * Umgebungsvariablen der API. Sie werden beim Start geprüft; ein ungültiger Wert verhindert den
 * Start. Fehlermeldungen nennen nur den Namen der Variablen, nie den Wert, weil Werte Geheimnisse
 * sein können.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_FORMAT: z.enum(['json', 'pretty']).default('json'),
  /**
   * Anzahl vertrauenswürdiger Proxys vor der API (hinter Caddy: 1). Bestimmt, welche IP als
   * Client gilt. Falsch gesetzt, landen alle Anfragen in einem Topf der Ratenbegrenzung oder die
   * IP lässt sich per Header fälschen.
   */
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  /** Verbindung der Anwendungsrolle (nur Datenzugriff, kein DDL). */
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  /**
   * Sitzungs-Cookie nur über HTTPS. Mit `true` heißt es `__Host-masar_session`; Safari akzeptiert
   * das auf http://localhost nicht, dort in der Entwicklung `false` setzen.
   */
  SESSION_COOKIE_SECURE: z.stringbool().default(true),
  /** Origins, die zustandsändernde Anfragen schicken dürfen (CSRF-Schutz), kommagetrennt. */
  APP_ORIGINS: z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.url().refine((url) => new URL(url).origin === url, 'origin')).min(1))
    .default(['http://localhost:3000', 'http://localhost:3002']),
  /** Basis für Links in E-Mails (Einladung, Passwort-Reset). */
  PORTAL_URL: z.url().default('http://localhost:3002'),
  SMTP_URL: z.url({ protocol: /^smtps?$/ }).default('smtp://localhost:1025'),
  MAIL_FROM: z.string().min(3).default('Masar <no-reply@masar.invalid>'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => String(issue.path[0] ?? '?')))];
    throw new Error(`Ungültige Umgebungsvariablen: ${names.join(', ')}`);
  }
  return result.data;
}
