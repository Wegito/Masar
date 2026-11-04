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
    <>
      <SiteHeader />
      <main>
        <section className="relative isolate overflow-hidden bg-forest-900 text-mist-50">
          {/* Foto: 31 KB auf dem Telefon, 104 KB am Schreibtisch; als Hintergrund, daher ohne Text. */}
          <picture>
            <source media="(min-width: 768px)" srcSet="/brand/hero.webp" />
            <img
              src="/brand/hero-sm.webp"
              alt=""
              width={720}
              height={408}
              fetchPriority="high"
              className="absolute inset-0 -z-20 h-full w-full object-cover"
            />
          </picture>
          <div className="absolute inset-0 -z-10 bg-linear-to-b from-forest-950/90 via-forest-900/75 to-forest-900/40 md:bg-linear-to-r md:from-forest-950/90 md:via-forest-900/70 md:to-forest-900/10 md:rtl:bg-linear-to-l" />
          <div className="mx-auto max-w-6xl px-4 pt-16 pb-14 md:pt-24 md:pb-20">
            <div className="animate-rise max-w-2xl">
              <div className="gold-rule mb-5 w-40" />
              <h1 className="text-4xl text-balance md:text-6xl">{t('title')}</h1>
              <p className="mt-5 max-w-lg text-base text-mist-50/85 md:text-lg">{t('tagline')}</p>
            </div>
            <div className="animate-rise mt-10 [animation-delay:150ms]">
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
                <p role="alert" className="rounded-md bg-red-50 p-4 text-red-900">
                  {t('citiesUnavailable')}
                </p>
              )}
            </div>
            <p className="mt-6 max-w-xl text-sm text-mist-50/80">{t('soon')}</p>
          </div>
        </section>
        <section className="bg-mist-100">
          <ul className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:grid-cols-3">
            {points.map((point) => (
              <li key={point} className="border-s-2 border-gold-400 ps-4 text-start">
                <h2 className="text-lg text-brand-800">{t(`points.${point}.title`)}</h2>
                <p className="mt-2 text-slate-700">{t(`points.${point}.text`)}</p>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}
