import { STATUS_CODES } from 'node:http';

import { type ErrorCode, httpStatusOf } from '@masar/shared';
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { AppError, type FieldError } from './app-error.js';
import { resolveRequestId } from './request-id.js';

interface Problem {
  status: number;
  code: ErrorCode;
  detail?: string;
  params?: Record<string, unknown>;
  errors?: FieldError[];
}

/** HTTP-Status technischer Fehler (Framework, Body-Parser) auf unsere stabilen Codes. */
const CODE_BY_STATUS: Partial<Record<number, ErrorCode>> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  429: 'RATE_LIMITED',
  503: 'SERVICE_UNAVAILABLE',
};

/** Status aus Nest-Exceptions oder aus Fehlern im Stil von `http-errors` (Body-Parser). */
function statusOf(exception: unknown): number | undefined {
  if (exception instanceof HttpException) {
    return exception.getStatus();
  }
  if (typeof exception === 'object' && exception !== null) {
    const { status, statusCode } = exception as { status?: unknown; statusCode?: unknown };
    const value = typeof status === 'number' ? status : statusCode;
    return typeof value === 'number' ? value : undefined;
  }
  return undefined;
}

export function toProblem(exception: unknown): Problem {
  if (exception instanceof AppError) {
    const { headers: _headers, ...options } = exception.options;
    return { status: exception.status, code: exception.code, ...options };
  }
  const status = statusOf(exception);
  if (status !== undefined && status >= 400 && (status < 500 || status === 503)) {
    // Unbekannte 4xx-Status (z. B. 405) werden zu einem einheitlichen VALIDATION_FAILED.
    const code = CODE_BY_STATUS[status] ?? 'VALIDATION_FAILED';
    return { status: httpStatusOf(code), code };
  }
  return { status: 500, code: 'INTERNAL_ERROR' };
}

/**
 * Einziger Ort, an dem Fehler zu HTTP-Antworten werden (RFC 9457, ADR 0015).
 * Interne Meldungen und Stacktraces landen nur im Log, nie in der Antwort.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request & { id?: unknown }>();
    const response = http.getResponse<Response>();
    const problem = toProblem(exception);

    let requestId = typeof request.id === 'string' ? request.id : undefined;
    if (requestId === undefined) {
      requestId = resolveRequestId(undefined);
      response.setHeader('X-Request-Id', requestId);
    }

    if (exception instanceof AppError) {
      for (const [name, value] of Object.entries(exception.options.headers ?? {})) {
        response.setHeader(name, value);
      }
    }

    if (problem.status >= 500) {
      this.logger.error({ err: exception }, 'Anfrage mit Serverfehler beendet');
    }

    response
      .status(problem.status)
      .type('application/problem+json')
      .json({
        type: 'about:blank',
        title: STATUS_CODES[problem.status] ?? 'Error',
        status: problem.status,
        code: problem.code,
        ...(problem.detail !== undefined && problem.status < 500 ? { detail: problem.detail } : {}),
        instance: `urn:uuid:${requestId}`,
        ...(problem.params !== undefined ? { params: problem.params } : {}),
        ...(problem.errors !== undefined ? { errors: problem.errors } : {}),
      });
  }
}
