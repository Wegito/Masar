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
