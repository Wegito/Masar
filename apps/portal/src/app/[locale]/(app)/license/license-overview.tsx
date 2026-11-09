'use client';

import type { Locale } from '@masar/shared';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import type { LicensePeriod, LicenseView } from '../../../../lib/license';
import { formatCalendarDay } from '../../../../lib/routes';

export const STATUS_BADGE: Record<LicenseView['status'], string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-900',
  EXPIRING_SOON: 'bg-amber-100 text-amber-900',
  EXPIRING_VERY_SOON: 'bg-amber-200 text-amber-950',
  GRACE: 'bg-red-100 text-red-900',
  EXPIRED: 'bg-red-200 text-red-950',
};

function Row({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="text-sm text-slate-600 sm:w-48 sm:shrink-0">{label}</dt>
      <dd className="font-medium tabular-nums">{children}</dd>
    </div>
  );
}

/**
 * Stand der Lizenz als Liste: Plan, Status, Zeitraum, Abdeckung, Kulanz, Planung, Pakete und
 * Busse, darunter alle Zeiträume. Nur Darstellung; die Zahlen kommen fertig aus der API.
 */
export function LicenseOverview({ license }: { license: LicenseView }): ReactNode {
  const t = useTranslations('license');
  const locale = useLocale() as Locale;
  const day = (value: string | null): string =>
    value === null ? '–' : formatCalendarDay(value, locale);

  return (
    <>
      <section
        aria-labelledby="license-current"
        className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="license-current" className="text-xl font-semibold">
            {t('page.current')}
          </h2>
          <span
            data-testid="license-status"
            className={`rounded-full px-2.5 py-0.5 text-sm font-medium ${STATUS_BADGE[license.status]}`}
          >
            {t(`status.${license.status}`)}
          </span>
        </div>
        {license.plan === null ? (
          <p className="text-slate-600">{t('page.none')}</p>
        ) : (
          <dl className="flex flex-col gap-2">
            <Row label={t('page.plan')}>{t(`plan.${license.plan}`)}</Row>
            <Row label={t('page.validity')}>
              {t('page.range', { from: day(license.validFrom), until: day(license.validUntil) })}
            </Row>
            <Row label={t('page.coveredUntil')}>{day(license.coveredUntil)}</Row>
            {license.daysUntilExpiry !== null && license.daysUntilExpiry >= 0 ? (
              <Row label={t('page.daysLeft')}>{String(license.daysUntilExpiry)}</Row>
            ) : null}
            <Row label={t('page.graceEndsOn')}>{day(license.graceEndsOn)}</Row>
            <Row label={t('page.planning')}>
              {license.planningAllowed ? t('page.planningAllowed') : t('page.planningBlocked')}
            </Row>
            <Row label={t('page.packages')}>
              {t('page.packagesValue', {
                packages: String(license.busPackages),
                allowed: String(license.allowedBuses),
              })}
            </Row>
            <Row label={t('page.activeBuses')}>{String(license.activeBuses)}</Row>
          </dl>
        )}
        {license.busesOverLimit > 0 ? (
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
            {t('page.overLimit', { count: String(license.busesOverLimit) })}
          </p>
        ) : null}
        {license.upcoming === null ? null : (
          <p className="text-sm text-slate-700">
            {t('page.upcoming', {
              plan: t(`plan.${license.upcoming.plan}`),
              from: day(license.upcoming.validFrom),
              until: day(license.upcoming.validUntil),
            })}
          </p>
        )}
        <p className="text-sm text-slate-600">{t('page.contact')}</p>
      </section>
      <PeriodTable periods={license.periods} />
    </>
  );
}

/** Alle Zeiträume als Tabelle; mit `notes` zusätzlich die interne Notiz (nur Plattform-Admin). */
export function PeriodTable({
  periods,
  notes,
}: {
  periods: (LicensePeriod & { id?: string; notes?: string | null })[];
  /** Spaltenkopf der internen Notiz; nur in der Sicht des Plattform-Admins. */
  notes?: string;
}): ReactNode {
  const t = useTranslations('license.page');
  const tPlan = useTranslations('license.plan');
  const locale = useLocale() as Locale;
  if (periods.length === 0) {
    return null;
  }
  return (
    <section aria-labelledby="license-history" className="flex flex-col gap-2">
      <h2 id="license-history" className="text-lg font-semibold">
        {t('history')}
      </h2>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th scope="col" className="px-3 py-2 text-start font-medium">
                {t('columns.plan')}
              </th>
              <th scope="col" className="px-3 py-2 text-start font-medium">
                {t('columns.from')}
              </th>
              <th scope="col" className="px-3 py-2 text-start font-medium">
                {t('columns.until')}
              </th>
              <th scope="col" className="px-3 py-2 text-start font-medium">
                {t('columns.packages')}
              </th>
              {notes === undefined ? null : (
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  {notes}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {periods.map((period) => (
              <tr
                key={period.id ?? `${period.validFrom}-${period.validUntil}`}
                className="border-t border-slate-100"
              >
                <td className="px-3 py-2">{tPlan(period.plan)}</td>
                <td className="px-3 py-2 tabular-nums">
                  {formatCalendarDay(period.validFrom, locale)}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {formatCalendarDay(period.validUntil, locale)}
                </td>
                <td className="px-3 py-2 tabular-nums">{String(period.busPackages)}</td>
                {notes === undefined ? null : (
                  <td className="px-3 py-2 text-slate-600">{period.notes ?? '–'}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
