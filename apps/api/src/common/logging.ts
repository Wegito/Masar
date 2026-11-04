import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Params } from 'nestjs-pino';
import { stdSerializers } from 'pino';
import type { Options } from 'pino-http';

import type { Env } from '../config/env.js';
import { REQUEST_ID_HEADER, resolveRequestId } from './request-id.js';

/**
 * Schlüssel, deren Werte nie im Log erscheinen dürfen. Das ist die zweite Verteidigungslinie;
 * die erste ist die Regel, Personen nur über IDs zu loggen. Die Liste folgt den Feldnamen mit
 * Personendaten in `prisma/schema.prisma`, den Zod-Schemas der Requests und den Domänentypen
 * (z. B. der geparste Suchtext `phoneSuffix`/`codePrefix`); ein neues Personenfeld gehört hierher.
 */
export const REDACTED_KEYS = [
  'password',
  'token',
  'otp',
  'phone',
  'phoneE164',
  'contactPhone',
  'contactPhoneE164',
  'email',
  'contactEmail',
  'fullName',
  'contactName',
  'displayName',
  'nationalId',
  'nationalIdLast4',
  'gender',
  'bookingCode',
  'manageToken',
  'accessToken',
  'qrToken',
  'notes',
  'q',
  'phoneSuffix',
  'codePrefix',
  'authorization',
  'cookie',
] as const;

/**
 * Pfade mit mehreren Segmenten für Schlüssel, die allein zu allgemein sind: `name` trägt auch
 * technische Werte (Job-, Haltestellen- oder Fehlernamen), unter `contact` aber den Kontaktnamen.
 */
export const REDACTED_NESTED_PATHS = ['contact.name'] as const;

/** Pfade für pino: auf oberster Ebene sowie eine und zwei Ebenen tief. */
export function redactPaths(): string[] {
  return [...REDACTED_KEYS, ...REDACTED_NESTED_PATHS].flatMap((key) => [
    key,
    `*.${key}`,
    `*.*.${key}`,
  ]);
}

/** Westliche, arabisch-indische (٠–٩) und persische (۰–۹) Ziffern. */
const DIGIT = '[0-9\\u0660-\\u0669\\u06F0-\\u06F9]';

/**
 * Bleiben lesbar, obwohl sie acht Ziffern mit Bindestrichen enthalten können: UUIDs und
 * ISO-Zeitstempel (Jahr 19xx/20xx, gültiger Monat und Tag, damit Telefonnummern nicht durchrutschen).
 */
const TECHNICAL =
  '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' +
  '|(?:19|20)\\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])' +
  '(?:[T ]\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?(?:Z|[+-]\\d{2}(?::?\\d{2})?)?)?';

/**
 * Ziffernfolge ab acht Stellen, optional mit `+` und öffnender Klammer davor; zwischen den Ziffern
 * höchstens zwei Trennzeichen aus Leerraum, Bindestrich, Punkt und Klammern
 * (`+963 (933) 123.456`).
 */
const DIGIT_RUN = `\\+?\\(?${DIGIT}(?:[\\s.()-]{0,2}${DIGIT}){7,}`;

const SCRUB_DIGITS = new RegExp(`(?<![0-9a-z])(?:${TECHNICAL})(?![0-9a-z])|(${DIGIT_RUN})`, 'giu');

/**
 * Maskiert Ziffernfolgen ab acht Stellen (Telefon- und Ausweisnummern), auch in arabisch-indischen
 * oder persischen Ziffern und mit Trennzeichen dazwischen. Gilt für Fehlermeldungen und
 * Stacktraces, die Bibliotheken mit Eingabewerten füllen können und die die Schwärzung nach
 * Feldnamen nicht erreicht. UUIDs und ISO-Zeitstempel bleiben lesbar.
 */
export function scrubDigits(text: string): string {
  return text.replace(SCRUB_DIGITS, (match, digits: string | undefined) =>
    digits === undefined ? match : '[REDACTED]',
  );
}

/**
 * Maskiert E-Mail-Adressen, auch mit Unicode oder Punycode in der Domain. SMTP-Server nennen die
 * Empfängeradresse oft in ihrer Fehlerantwort (`550 5.1.1 <name@firma.example>`). Die Endung muss
 * mit einem Buchstaben beginnen, damit Paketpfade wie `pkg@1.2.3` im Stacktrace lesbar bleiben.
 */
export function scrubEmails(text: string): string {
  return text.replace(
    /[\p{L}\p{N}.!#$%&'*+=?^_`{|}~-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}[\p{L}\p{N}-]*/gu,
    '[REDACTED]',
  );
}

/** Zweite Verteidigungslinie für Freitext im Log: E-Mail-Adressen und lange Ziffernfolgen. */
function scrub(text: string): string {
  return scrubDigits(scrubEmails(text));
}

/** Technischer Code eines Fehlers (z. B. `EENVELOPE`, `23P01`), falls kurz genug für einen Code. */
function errorCode(error: object): { code?: string } {
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code.length <= 40 ? { code } : {};
}

/**
 * Fehler im Log: nur Typ, Meldung, Stacktrace und ein technischer Code. Weitere Eigenschaften
 * (z. B. `cause` oder Metadaten einer Bibliothek) können Eingabewerte enthalten und fallen weg.
 */
export function serializeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { type: typeof error, message: scrub(String(error)) };
  }
  const serialized = stdSerializers.err(error);
  return {
    type: serialized.type,
    message: scrub(serialized.message),
    stack: scrub(serialized.stack),
    ...errorCode(error),
  };
}

/**
 * Kurzform für Fehler externer Dienste (z. B. SMTP), deren Meldung Personendaten wie die
 * Empfängeradresse enthalten kann: nur Fehlerklasse und Code, ohne Meldung und Stacktrace.
 * Im Log unter einem anderen Schlüssel als `err` ablegen, sonst greift `serializeError`.
 */
export function errorSummary(error: unknown): { type: string; code?: string } {
  if (!(error instanceof Error)) {
    return { type: typeof error };
  }
  return { type: error.constructor.name, ...errorCode(error) };
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
