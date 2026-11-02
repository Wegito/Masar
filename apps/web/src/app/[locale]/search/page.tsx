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
  'rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600';

export default async function SearchPage({ params, searchParams }: PageProps): Promise<ReactNode> {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const t = await getTranslations('results');
  const parsed = parseSearchQuery(await searchParams);

  if (!parsed.ok) {
    const tInvalid = await getTranslations('invalidSearch');
    return (
      <Shell>
        <p role="alert" className="rounded-xl bg-amber-50 p-4 text-amber-900">
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

  return (
    <Shell>
      <section className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold leading-tight">
          {t('title', { from: cityName(query.from), to: cityName(query.to) })}
        </h1>
        <p className="text-slate-600">
          {t('summary', {
            date: formatDate(calendarDateInstant(query.date), locale, 'full'),
            passengers: t('passengerCount', {
              count: query.passengers,
              label: String(query.passengers),
            }),
          })}
        </p>
        <nav aria-label={t('listLabel')} className="flex flex-wrap gap-2 pt-1">
          {query.date > today ? (
            <Link href={searchHref(day(addDays(query.date, -1)))} className={LINK_BUTTON}>
              {t('previousDay')}
            </Link>
          ) : null}
          <Link href={searchHref(day(addDays(query.date, 1)))} className={LINK_BUTTON}>
            {t('nextDay')}
          </Link>
          <Link href={changeSearch} className={LINK_BUTTON}>
            {t('changeSearch')}
          </Link>
        </nav>
      </section>

      {!result.ok ? (
        <ProblemNotice code={result.problem.code}>
          <Link href={searchHref(query)} className={`${LINK_BUTTON} self-start bg-white`}>
            {(await getTranslations('errors'))('retry')}
          </Link>
        </ProblemNotice>
      ) : result.data.items.length === 0 ? (
        <section className="flex flex-col gap-2 rounded-xl border border-dashed border-slate-300 p-6 text-center">
          <h2 className="text-lg font-semibold">{t('emptyTitle')}</h2>
          <p className="text-slate-600">{t('emptyText')}</p>
        </section>
      ) : (
        <ul aria-label={t('listLabel')} className="flex flex-col gap-3">
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

function Shell({ children }: { children: ReactNode }): ReactNode {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6">
      <SiteHeader />
      {children}
    </main>
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
      className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-brand-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
    >
      <div className="flex items-center gap-3 text-xl font-bold">
        <time
          dateTime={item.departureAt}
          aria-label={t('departure', { time: formatTime(item.departureAt, locale) })}
        >
          {formatTime(item.departureAt, locale)}
        </time>
        <span aria-hidden="true" className="h-px flex-1 bg-slate-300" />
        {item.arrivalAt === null ? null : (
          <span className="flex items-baseline gap-1">
            <time
              dateTime={item.arrivalAt}
              aria-label={t('arrival', { time: formatTime(item.arrivalAt, locale) })}
            >
              {formatTime(item.arrivalAt, locale)}
            </time>
            {days > 0 ? (
              <span className="text-xs font-semibold text-amber-700">
                {t.rich('nextDayArrival', {
                  days: String(days),
                  n: (chunks) => <bdi dir="ltr">{chunks}</bdi>,
                })}
              </span>
            ) : null}
          </span>
        )}
      </div>
      <div className="flex justify-between gap-3 text-sm text-slate-600">
        <span>{localizedName(item.from, locale)}</span>
        <span className="text-end">{localizedName(item.to, locale)}</span>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-2 border-t border-slate-100 pt-3">
        <div className="flex flex-col">
          <span className="font-semibold">{localizedName(item.company, locale)}</span>
          <span className="text-sm text-emerald-700">
            {t.rich('freeSeats', {
              count: item.freeSeats.count,
              label: freeSeatsLabel(item.freeSeats),
              // „9+" bleibt auch im arabischen Text in dieser Reihenfolge.
              n: (chunks) => <bdi dir="ltr">{chunks}</bdi>,
            })}
          </span>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-lg font-bold">{formatFare(item.fare, locale)}</span>
          <span className="text-xs text-slate-500">{t('perPerson')}</span>
        </div>
      </div>
      <span className="self-end text-sm font-semibold text-brand-700">{t('chooseSeats')}</span>
    </Link>
  );
}
