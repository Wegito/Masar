import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { problemMessageKey } from '../lib/problem';

/**
 * Fehlerhinweis aus dem stabilen Code der API. Der Text entsteht nur hier (ADR 0015); Codes ohne
 * eigenen Text zeigen einen allgemeinen Hinweis. Funktioniert in Server- und Client-Komponenten.
 */
export function ProblemNotice({
  code,
  children,
}: {
  code: string;
  children?: ReactNode;
}): ReactNode {
  const t = useTranslations('errors');
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-xl bg-red-50 p-4 text-red-900">
      <p>{t(problemMessageKey(code))}</p>
      {children}
    </div>
  );
}
