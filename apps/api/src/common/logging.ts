import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Params } from 'nestjs-pino';
import { stdSerializers } from 'pino';
import type { Options } from 'pino-http';

import type { Env } from '../config/env.js';
import { REQUEST_ID_HEADER, resolveRequestId } from './request-id.js';

/**
 * Schlüssel, deren Werte nie im Log erscheinen dürfen. Das ist die zweite Verteidigungslinie;
 * die erste ist die Regel, Personen nur über IDs zu loggen.
 */
export const REDACTED_KEYS = [
  'password',
  'token',
  'otp',
  'phone',
  'contactPhone',
  'contactPhoneE164',
  'email',
  'fullName',
  'contactName',
  'nationalId',
  'gender',
  'bookingCode',
  'authorization',
  'cookie',
] as const;

/** Pfade für pino: auf oberster Ebene sowie eine und zwei Ebenen tief. */
export function redactPaths(): string[] {
  return REDACTED_KEYS.flatMap((key) => [key, `*.${key}`, `*.*.${key}`]);
}

/**
 * Maskiert Ziffernfolgen ab acht Stellen (Telefon- und Ausweisnummern), auch mit Leerzeichen oder
 * Bindestrichen dazwischen. Gilt für Fehlermeldungen und Stacktraces, die Bibliotheken mit
 * Eingabewerten füllen können und die die Schwärzung nach Feldnamen nicht erreicht.
 */
export function scrubDigits(text: string): string {
  return text.replace(/\+?\d(?:[\s-]?\d){7,}/g, '[REDACTED]');
}

/**
 * Fehler im Log: nur Typ, Meldung, Stacktrace und ein technischer Code. Weitere Eigenschaften
 * (z. B. `cause` oder Metadaten einer Bibliothek) können Eingabewerte enthalten und fallen weg.
 */
export function serializeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { type: typeof error, message: scrubDigits(String(error)) };
  }
  const serialized = stdSerializers.err(error);
  const code = (error as { code?: unknown }).code;
  return {
    type: serialized.type,
    message: scrubDigits(serialized.message),
    stack: scrubDigits(serialized.stack),
    ...(typeof code === 'string' && code.length <= 40 ? { code } : {}),
  };
}

interface MinimalRequest {
  id?: unknown;
  method?: string;
  url?: string;
}

/**
 * Optionen für den HTTP-Logger. Anfragen werden nur mit ID, Methode und Pfad geloggt:
 * keine Header, keine Query-Parameter, kein Body.
 */
export function pinoHttpOptions(env: Pick<Env, 'LOG_LEVEL' | 'LOG_FORMAT'>): Options {
  return {
    level: env.LOG_LEVEL,
    redact: { paths: redactPaths(), censor: '[REDACTED]' },
    genReqId: (req: IncomingMessage, res: ServerResponse) => {
      const id = resolveRequestId(req.headers[REQUEST_ID_HEADER]);
      res.setHeader('X-Request-Id', id);
      return id;
    },
    serializers: {
      req: (req: MinimalRequest) => ({
        id: req.id,
        method: req.method,
        path: req.url?.split('?')[0],
      }),
      res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
      err: serializeError,
    },
    customLogLevel: (_req, res, error) =>
      error !== undefined || res.statusCode >= 500 ? 'error' : 'info',
    autoLogging: { ignore: (req) => req.url?.startsWith('/api/health') ?? false },
    ...(env.LOG_FORMAT === 'pretty'
      ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
      : {}),
  };
}

export function loggerParams(env: Pick<Env, 'LOG_LEVEL' | 'LOG_FORMAT'>): Params {
  return { pinoHttp: pinoHttpOptions(env) };
}
