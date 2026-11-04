import type { Locale } from '@masar/shared';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { companyName } from '../../../lib/company';
import { getPortalSession } from '../../../lib/session';

const TILES = ['tripsToday', 'openCashReservations', 'buses', 'routes'] as const;

/** Startseite: Begrüßung und Kacheln als Platzhalter, bis die Zahlen eine API haben (Phase 2). */
export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<ReactNode> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'home' });
  const tRoles = await getTranslations({ locale, namespace: 'roles' });
  const session = await getPortalSession();
  if (session === null) {
    // Das Layout leitet vorher weiter; hier nur, damit die Seite nie ohne Sitzung rendert.
    return null;
  }
  const { user, company } = session;

  return (
    <>
      <section className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-slate-700">{t('greeting', { name: user.displayName })}</p>
        {company === null ? (
          <p className="text-slate-600">{t('noCompany')}</p>
        ) : (
          <p className="text-slate-600">
            {t('workingIn', { company: companyName(company, locale), role: tRoles(company.role) })}
          </p>
        )}
      </section>
      <section aria-label={t('overview')} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {TILES.map((tile) => (
          <article
            key={tile}
            className="flex flex-col gap-2 rounded-md border border-dashed border-slate-300 bg-white p-4"
          >
            <h2 className="text-sm font-medium text-slate-600">{t(`tiles.${tile}`)}</h2>
            <p className="text-2xl font-bold text-slate-300" aria-hidden="true">
              –
            </p>
            <p className="text-xs text-slate-500">{t('tileSoon')}</p>
          </article>
        ))}
      </section>
    </>
  );
}
