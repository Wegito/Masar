'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import type { Problem } from '../lib/api';

const KNOWN_CODES = new Set([
  'INVALID_CREDENTIALS',
  'LOGIN_THROTTLED',
  'RATE_LIMITED',
  'INVITATION_INVALID',
  'PASSWORD_RESET_INVALID',
  'ALREADY_MEMBER',
  'UNAUTHENTICATED',
  'NETWORK_ERROR',
]);

/** Übersetzt einen Fehlercode der API; Texte entstehen nur hier, nie in der API (ADR 0015). */
export function ProblemMessage({
  problem,
  retryAfterSeconds,
}: {
  problem: Problem;
  retryAfterSeconds?: number;
}): ReactNode {
  const t = useTranslations('errors');
  const tooShort = problem.errors?.some(
    (error) => error.path === 'password' && error.rule === 'too_small',
  );
  const text = tooShort
    ? t('passwordTooShort')
    : KNOWN_CODES.has(problem.code)
      ? t(problem.code, { seconds: retryAfterSeconds ?? 60 })
      : t('generic');
  return (
    <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
      {text}
    </p>
  );
}
