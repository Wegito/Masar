'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { ProblemMessage } from '../../../../components/problem-message';
import type { Problem } from '../../../../lib/api';

/** Codes mit eigenem Text am Schalter; alles andere übersetzt `ProblemMessage`. */
const COUNTER_CODES = new Set([
  'SEAT_TAKEN',
  'SEAT_BLOCKED',
  'SEAT_UNKNOWN',
  'GENDER_RULE_CONFLICT',
  'GENDER_REQUIRED',
  'NATIONAL_ID_REQUIRED',
  'TOO_MANY_SEATS',
  'SALES_CLOSED',
  'NO_FARE_FOR_SEGMENT',
  'INVALID_SEGMENT',
  'IDEMPOTENCY_KEY_REUSED',
  'VALIDATION_FAILED',
]);

function seatsOf(params: Record<string, unknown> | undefined): string {
  const seats = params?.['seats'];
  return Array.isArray(seats) ? seats.map(String).join(', ') : '';
}

/** Fehler der API am Schalter; Sitzbeschriftungen aus `params.seats`, nie Personendaten. */
export function CounterProblem({
  problem,
  retryAfterSeconds,
}: {
  problem: Problem;
  retryAfterSeconds?: number;
}): ReactNode {
  const t = useTranslations('counter.errors');
  if (!COUNTER_CODES.has(problem.code)) {
    return (
      <ProblemMessage
        problem={problem}
        {...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds })}
      />
    );
  }
  const max = problem.params?.['max'];
  return (
    <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
      {t(problem.code, {
        seats: seatsOf(problem.params),
        max: typeof max === 'number' ? max : 9,
      })}
    </p>
  );
}
