import { formatDate, formatTime, type Locale, localDateInDamascus } from '@masar/shared';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';

import { ProblemNotice } from '../../../components/problem-notice';
import { SiteHeader } from '../../../components/site-header';
import { Link } from '../../../i18n/navigation';
import { apiGet } from '../../../lib/api';
import { arrivalDayOffset, formatFare, freeSeatsLabel, localizedName } from '../../../lib/format';
import {
  addDays,
  calendarDateInstant,
  parseSearchQuery,
  type RawParams,
  type SearchQuery,
  searchHref,
  seatPageHref,
} from '../../../lib/search';
import type { CitiesResponse, TripSearchItem, TripSearchResponse } from '../../../lib/types';

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<RawParams>;
}

/** Eine Seite Ergebnisse; ein Tag hat in der Regel weniger Fahrten je Strecke. */
const PAGE_SIZE = 20;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'results' });
  // Ergebnisseiten ändern sich minütlich und gehören nicht in Suchmaschinen.
  return { title: t('listLabel'), robots: { index: false, follow: true } };
}

const LINK_BUTTON =
  'rounded-md border border-brand-200 bg-white px-3 py-2 text-sm font-medium text-brand-800 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600';
/** Auf dem dunklen Band über der Liste. */
const LINK_BUTTON_DARK =
  'rounded-md border border-white/30 px-3 py-2 text-sm font-medium text-mist-50 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-400';

export default async function SearchPage({ params, searchParams }: PageProps): Promise<ReactNode> {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const t = await getTranslations('results');
  const parsed = parseSearchQuery(await searchParams);

  if (!parsed.ok) {
    const tInvalid = await getTranslations('invalidSearch');
    return (
      <Shell>
        <p role="alert" className="rounded-md bg-amber-50 p-4 text-amber-900">
          {tInvalid(parsed.reason)}
        </p>
        <Link href="/" className={`${LINK_BUTTON} self-start`}>
          {tInvalid('back')}
        </Link>
      </Shell>
    );
  }

  const { query } = parsed;
  const [cities, result] = await Promise.all([
    apiGet<CitiesResponse>('/cities', {}, { revalidate: 300 }),
    apiGet<TripSearchResponse>('/trips/search', {
      from: query.from,
      to: query.to,
      date: query.date,
      passengers: query.passengers,
      limit: PAGE_SIZE,
      cursor: query.cursor,
    }),
  ]);
  const cityName = (id: string): string => {
    const city = cities.ok ? cities.data.items.find((item) => item.id === id) : undefined;
    return city === undefined ? '…' : localizedName(city, locale);
  };

  const today = localDateInDamascus(new Date());
  const day = (date: string): SearchQuery => ({
    from: query.from,
    to: query.to,
    date,
    passengers: query.passengers,
  });
  const changeSearch = searchHref(day(query.date)).replace('/search', '/');

  const band = (
    <section className="flex flex-col gap-2">
      <h1 className="text-3xl text-balance md:text-4xl">
        {t('title', { from: cityName(query.from), to: cityName(query.to) })}
      </h1>
      <p className="text-mist-100/85">
        {t('summary', {
          date: formatDate(calendarDateInstant(query.date), locale, 'full'),
          passengers: t('passengerCount', {
            count: query.passengers,
            label: String(query.passengers),
          }),
        })}
      </p>
      <nav aria-label={t('listLabel')} className="flex flex-wrap gap-2 pt-3">
        {query.date > today ? (
          <Link href={searchHref(day(addDays(query.date, -1)))} className={LINK_BUTTON_DARK}>
            {t('previousDay')}
          </Link>
        ) : null}
        <Link href={searchHref(day(addDays(query.date, 1)))} className={LINK_BUTTON_DARK}>
          {t('nextDay')}
        </Link>
        <Link href={changeSearch} className={LINK_BUTTON_DARK}>
          {t('changeSearch')}
        </Link>
      </nav>
    </section>
  );

  return (
    <Shell band={band}>
      {!result.ok ? (
        <ProblemNotice code={result.problem.code}>
          <Link href={searchHref(query)} className={`${LINK_BUTTON} self-start bg-white`}>
            {(await getTranslations('errors'))('retry')}
          </Link>
        </ProblemNotice>
      ) : result.data.items.length === 0 ? (
        <section className="flex flex-col gap-2 rounded-lg border border-dashed border-brand-300 bg-white p-8 text-center">
          <h2 className="text-lg text-brand-800">{t('emptyTitle')}</h2>
          <p className="text-slate-600">{t('emptyText')}</p>
        </section>
      ) : (
        <ul aria-label={t('listLabel')} className="flex flex-col gap-4">
          {result.data.items.map((item) => (
            <li key={`${item.tripId}:${item.from.tripStopId}:${item.to.tripStopId}`}>
              <TripCard item={item} locale={locale} passengers={query.passengers} />
            </li>
          ))}
        </ul>
      )}

      {result.ok && (result.data.nextCursor !== null || query.cursor !== undefined) ? (
        <nav className="flex flex-wrap gap-2">
          {query.cursor === undefined ? null : (
            <Link href={searchHref(day(query.date))} className={LINK_BUTTON}>
              {t('firstPage')}
            </Link>
          )}
          {result.data.nextCursor === null ? null : (
            <Link
              href={searchHref({ ...day(query.date), cursor: result.data.nextCursor })}
              className={LINK_BUTTON}
            >
              {t('more')}
            </Link>
          )}
        </nav>
      ) : null}
    </Shell>
  );
}

function Shell({ band, children }: { band?: ReactNode; children: ReactNode }): ReactNode {
  return (
    <>
      <SiteHeader />
      {band === undefined ? null : (
        <div className="bg-forest-900 text-mist-50">
          <div className="gold-rule" />
          <div className="mx-auto max-w-6xl px-4 py-8">{band}</div>
        </div>
      )}
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 pt-8 pb-12">
        {children}
      </main>
    </>
  );
}

async function TripCard({
  item,
  locale,
  passengers,
}: {
  item: TripSearchItem;
  locale: Locale;
  passengers: number;
}): Promise<ReactNode> {
  const t = await getTranslations('results');
  const days = arrivalDayOffset(item.departureAt, item.arrivalAt);
  return (
    <Link
      href={seatPageHref(item.tripId, {
        fromStopId: item.from.tripStopId,
        toStopId: item.to.tripStopId,
        passengers,
      })}
      // Auf schwachen Netzen nichts im Voraus laden; erst der Tipp lädt den Sitzplan.
      prefetch={false}
      className="group grid gap-5 rounded-lg border border-brand-100 bg-white p-5 shadow-[0_8px_24px_-16px_rgb(10_40_25/0.35)] hover:border-brand-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 md:grid-cols-[1fr_2fr_auto] md:items-center"
    >
      <div className="flex flex-col gap-1">
        <span className="text-lg font-semibold text-forest-900">
          {localizedName(item.company, locale)}
        </span>
        <span className="text-sm text-brand-700">
          {t.rich('freeSeats', {
            count: item.freeSeats.count,
            label: freeSeatsLabel(item.freeSeats),
            // „9+" bleibt auch im arabischen Text in dieser Reihenfolge.
            n: (chunks) => <bdi dir="ltr">{chunks}</bdi>,
          })}
        </span>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex flex-col">
          <time
            dateTime={item.departureAt}
            aria-label={t('departure', { time: formatTime(item.departureAt, locale) })}
            className="font-display text-2xl"
          >
            {formatTime(item.departureAt, locale)}
          </time>
          <span className="text-sm text-slate-600">{localizedName(item.from, locale)}</span>
        </div>
        <div
          aria-hidden="true"
          className="relative h-px w-10 shrink-0 bg-brand-200 md:w-auto md:flex-1"
        >
          <span className="absolute -top-1 start-0 h-2.5 w-2.5 rounded-full border border-brand-700 bg-white" />
          <span className="absolute -top-1 end-0 h-2.5 w-2.5 rounded-full bg-brand-700" />
        </div>
        {item.arrivalAt === null ? null : (
          <div className="flex flex-col">
            <span className="flex items-baseline gap-1">
              <time
                dateTime={item.arrivalAt}
                aria-label={t('arrival', { time: formatTime(item.arrivalAt, locale) })}
                className="font-display text-2xl"
              >
                {formatTime(item.arrivalAt, locale)}
              </time>
              {days > 0 ? (
                <span className="text-xs font-semibold text-crimson-600">
                  {t.rich('nextDayArrival', {
                    days: String(days),
                    n: (chunks) => <bdi dir="ltr">{chunks}</bdi>,
                  })}
                </span>
              ) : null}
            </span>
            <span className="text-sm text-slate-600">{localizedName(item.to, locale)}</span>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-5 border-t border-brand-100 pt-4 md:flex-col md:items-end md:border-0 md:pt-0">
        <div className="flex flex-col md:items-end">
          <span className="font-display text-2xl text-brand-700">
            {formatFare(item.fare, locale)}
          </span>
          <span className="text-xs text-slate-500">{t('perPerson')}</span>
        </div>
        <span className="rounded-md bg-brand-700 px-4 py-2 text-sm font-semibold text-white group-hover:bg-brand-800">
          {t('chooseSeats')}
        </span>
      </div>
    </Link>
  );
}
