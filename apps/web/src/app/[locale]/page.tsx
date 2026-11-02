import { type Locale, localDateInDamascus } from '@masar/shared';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';

import { SearchForm } from '../../components/search-form';
import { SiteHeader } from '../../components/site-header';
import { apiGet } from '../../lib/api';
import { isUuid, parsePassengers, type RawParams, single } from '../../lib/search';
import type { CitiesResponse } from '../../lib/types';

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<RawParams>;
}

/** Die Städteliste ändert sich selten; fünf Minuten im Cache sparen Anfragen an die API. */
const CITIES_REVALIDATE_SECONDS = 300;

export default async function HomePage({ params, searchParams }: PageProps): Promise<ReactNode> {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const t = await getTranslations('home');
  const raw = await searchParams;
  const cities = await apiGet<CitiesResponse>(
    '/cities',
    {},
    { revalidate: CITIES_REVALIDATE_SECONDS },
  );

  // „Suche ändern" führt mit den bisherigen Werten hierher zurück.
  const from = single(raw, 'from');
  const to = single(raw, 'to');
  const date = single(raw, 'date');
  const passengers = parsePassengers(single(raw, 'passengers'));
  const points = ['seat', 'women', 'payment'] as const;

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-6">
      <SiteHeader />
      <section className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold leading-tight">{t('title')}</h1>
        <p className="text-lg text-slate-600">{t('tagline')}</p>
      </section>
      {cities.ok ? (
        <SearchForm
          cities={cities.data.items}
          locale={locale}
          today={localDateInDamascus(new Date())}
          defaults={{
            ...(isUuid(from) ? { from } : {}),
            ...(isUuid(to) ? { to } : {}),
            ...(date === undefined ? {} : { date }),
            ...(passengers === null ? {} : { passengers }),
          }}
        />
      ) : (
        <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-900">
          {t('citiesUnavailable')}
        </p>
      )}
      <p className="rounded-xl bg-brand-50 p-4 text-brand-900">{t('soon')}</p>
      <ul className="flex flex-col gap-3">
        {points.map((point) => (
          <li key={point} className="rounded-xl border border-slate-200 p-4 text-start">
            <p className="font-semibold">{t(`points.${point}.title`)}</p>
            <p className="text-slate-600">{t(`points.${point}.text`)}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
