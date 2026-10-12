import { NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { AppError } from './app-error.js';
import { toProblem } from './problem-details.filter.js';

describe('Abbildung von Fehlern auf Codes', () => {
  it('übernimmt Code, Status und Parameter fachlicher Fehler', () => {
    expect(toProblem(new AppError('SEAT_TAKEN', { params: { seats: ['12'] } }))).toEqual({
      status: 409,
      code: 'SEAT_TAKEN',
      params: { seats: ['12'] },
    });
  });

  it('übersetzt Framework-Ausnahmen über den HTTP-Status', () => {
    expect(toProblem(new NotFoundException())).toEqual({ status: 404, code: 'NOT_FOUND' });
  });

  it('erkennt Fehler im Stil von http-errors (z. B. vom Body-Parser)', () => {
    const parseError = Object.assign(new Error('Unexpected token'), { status: 400 });
    expect(toProblem(parseError)).toEqual({ status: 400, code: 'VALIDATION_FAILED' });
  });

  it('vereinheitlicht unbekannte 4xx-Status', () => {
    expect(toProblem(Object.assign(new Error('x'), { statusCode: 405 }))).toEqual({
      status: 400,
      code: 'VALIDATION_FAILED',
    });
  });

  it('macht aus allem Unbekannten INTERNAL_ERROR ohne Details', () => {
    expect(toProblem(new Error('interne Details'))).toEqual({
      status: 500,
      code: 'INTERNAL_ERROR',
    });
    expect(toProblem('kein Error-Objekt')).toEqual({ status: 500, code: 'INTERNAL_ERROR' });
  });
});
