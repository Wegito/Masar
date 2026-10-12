import { type ErrorCode, httpStatusOf } from '@masar/shared';
import type { StandardSchemaValidationPipeOptions } from '@nestjs/common';

/** Ein verletztes Feld bei VALIDATION_FAILED. `rule` ist der Code des Validators, z. B. `invalid_type`. */
export interface FieldError {
  path: string;
  rule: string;
}

export interface AppErrorOptions {
  /** Englische Erklärung für Entwickler. Nie personenbezogene Daten. */
  detail?: string;
  /** Unkritische Werte für den Nutzertext im Frontend, z. B. Sitzbeschriftungen. */
  params?: Record<string, unknown>;
  errors?: FieldError[];
  /** Zusätzliche Antwort-Header, z. B. `Retry-After` bei LOGIN_THROTTLED. */
  headers?: Record<string, string>;
}

/**
 * Fachlicher Fehler mit stabilem Code (siehe docs/api-konventionen.md). Der globale Filter macht
 * daraus eine Antwort nach RFC 9457; der HTTP-Status ergibt sich aus dem Code.
 */
export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    readonly options: AppErrorOptions = {},
  ) {
    super(options.detail ?? code);
    this.name = 'AppError';
    this.status = httpStatusOf(code);
  }
}

type SchemaIssues = Parameters<
  NonNullable<StandardSchemaValidationPipeOptions['exceptionFactory']>
>[0];

function issuePath(issue: SchemaIssues[number]): string {
  return (issue.path ?? [])
    .map((segment) => String(typeof segment === 'object' ? segment.key : segment))
    .join('.');
}

/**
 * Übersetzt Schema-Verletzungen (Standard Schema, z. B. Zod) in VALIDATION_FAILED.
 * Zod liefert je Verletzung einen `code`; andere Validatoren ohne Code ergeben `invalid`.
 */
export function validationFailed(issues: SchemaIssues): AppError {
  return new AppError('VALIDATION_FAILED', {
    detail: 'The request does not match the expected schema.',
    errors: issues.map((issue) => {
      const code = (issue as { code?: unknown }).code;
      return { path: issuePath(issue), rule: typeof code === 'string' ? code : 'invalid' };
    }),
  });
}
