import { z } from 'zod';

/** Geheimer Schlüssel als base64 mit mindestens 32 Bytes; der Wert erscheint nie in Meldungen. */
const secretKey = z
  .string()
  .refine(
    (value) => /^[A-Za-z0-9+/_-]+={0,2}$/.test(value) && Buffer.from(value, 'base64').length >= 32,
  );

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
  /**
   * Schlüssel für Ausweisnummern (AES-256-GCM, ADR 0016), kommagetrennt als `keyId:base64`, je
   * Schlüssel 32 Bytes. Der erste verschlüsselt neue Werte, alle entschlüsseln (Rotation). Ohne
   * Angabe nimmt die API keine Buchung bei Firmen an, die eine Ausweisnummer verlangen.
   */
  NATIONAL_ID_KEYS: z.string().min(1).optional(),
  /**
   * HMAC-Schlüssel, aus dem die QR-Tokens der Tickets abgeleitet werden (ADR 0022), base64 mit
   * mindestens 32 Bytes. Ein Wechsel macht alle bisher gezeigten QR-Codes ungültig, sobald die
   * Ticketseite sie neu ableitet. In Produktion Pflicht.
   */
  TICKET_QR_KEY: secretKey.optional(),
  /**
   * HMAC-Schlüssel für kurzlebige Lesetokens nach Code und Telefon (ADR 0022), base64 mit
   * mindestens 32 Bytes. Ein Wechsel beendet nur laufende Lesezugriffe. In Produktion Pflicht.
   */
  BOOKING_ACCESS_KEY: secretKey.optional(),
  /**
   * Hintergrundjobs im API-Prozess: Ablauf von Buchungen und Zustellung der Outbox (ADR 0021).
   * Tests schalten sie ab und rufen die Jobs selbst auf.
   */
  BOOKING_JOBS_ENABLED: z.stringbool().default(true),
});

/** Ohne diese Schlüssel startet die API in Produktion nicht (ADR 0022). */
const PRODUCTION_SECRETS = ['TICKET_QR_KEY', 'BOOKING_ACCESS_KEY'] as const;

const checkedEnvSchema = envSchema.superRefine((env, ctx) => {
  if (env.NODE_ENV !== 'production') {
    return;
  }
  for (const name of PRODUCTION_SECRETS) {
    if (env[name] === undefined) {
      ctx.addIssue({ code: 'custom', path: [name], message: 'required in production' });
    }
  }
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = checkedEnvSchema.safeParse(raw);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => String(issue.path[0] ?? '?')))];
    throw new Error(`Ungültige Umgebungsvariablen: ${names.join(', ')}`);
  }
  return result.data;
}
