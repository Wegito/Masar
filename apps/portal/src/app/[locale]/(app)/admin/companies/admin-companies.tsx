'use client';

import type { Locale } from '@masar/shared';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useState } from 'react';

import { ProblemMessage } from '../../../../../components/problem-message';
import { Link } from '../../../../../i18n/navigation';
import { api, type Problem } from '../../../../../lib/api';
import type { AdminCompanyItem } from '../../../../../lib/license';
import { formatCalendarDay, localName } from '../../../../../lib/routes';
import { STATUS_BADGE } from '../../license/license-overview';

/** Liste der Firmen mit Lizenzstand; Daten aus `GET /admin/companies`. */
export function AdminCompanies(): ReactNode {
  const t = useTranslations('admin');
  const tStatus = useTranslations('license.status');
  const locale = useLocale() as Locale;
  const [items, setItems] = useState<AdminCompanyItem[]>();
  const [problem, setProblem] = useState<Problem>();

  useEffect(() => {
    void api<{ items: AdminCompanyItem[] }>('/admin/companies').then((result) => {
      if (result.ok) {
        setItems(result.data.items);
      } else {
        setProblem(result.problem);
      }
    });
  }, []);

  if (problem !== undefined) {
    return <ProblemMessage problem={problem} />;
  }
  if (items === undefined) {
    return <p className="text-slate-600">{t('loading')}</p>;
  }
  if (items.length === 0) {
    return <p className="text-slate-600">{t('empty')}</p>;
  }
  return (
    <section aria-labelledby="admin-companies" className="flex flex-col gap-2">
      <h2 id="admin-companies" className="text-xl font-semibold">
        {t('companies')}
      </h2>
      <ul className="flex flex-col gap-2">
        {items.map((company) => {
          const name = localName(company, locale);
          return (
            <li key={company.id}>
              <article
                aria-label={name}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4"
              >
                <div className="flex flex-col gap-0.5">
                  <h3 className="font-semibold">{name}</h3>
                  <p className="text-sm text-slate-600 tabular-nums">
                    {t('until')}:{' '}
                    {company.license.coveredUntil === null
                      ? '–'
                      : formatCalendarDay(company.license.coveredUntil, locale)}
                    {' · '}
                    {t('buses')}:{' '}
                    {t('busesValue', {
                      active: String(company.license.activeBuses),
                      allowed: String(company.license.allowedBuses),
                    })}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE[company.license.status]}`}
                  >
                    {tStatus(company.license.status)}
                  </span>
                  <Link
                    href={`/admin/companies/${company.id}/license`}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
                  >
                    {t('manage')}
                  </Link>
                </div>
              </article>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
