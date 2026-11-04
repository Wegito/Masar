import { formatDate, formatTime, type Locale, localDateInDamascus } from '@masar/shared';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';

import { BookingFlow } from '../../../../components/booking-flow';
import { ProblemNotice } from '../../../../components/problem-notice';
import { SiteHeader } from '../../../../components/site-header';
import { Link } from '../../../../i18n/navigation';
import { apiSend } from '../../../../lib/api';
import { arrivalDayOffset, formatFare, localizedName } from '../../../../lib/format';
import { isUuid, parseSeatPageQuery, type RawParams, searchHref } from '../../../../lib/search';
import type { SeatMapResponse } from '../../../../lib/types';

interface PageProps {
  params: Promise<{ locale: string; tripId: string }>;
  searchParams: Promise<RawParams>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'trip' });
  return { title: t('seatMapHeading'), robots: { index: false, follow: false } };
}

const LINK_BUTTON =
  'self-start rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600';

/**
 * Fahrt-Seite mit dem Buchungsablauf (ADR 0034). Die URL enthält Fahrt, Teilstrecke und Anzahl,
 * nie Personendaten oder das Geschlecht. Der erste Abruf ohne Geschlechter prüft, ob die Fahrt
 * buchbar ist, und liefert Kopf, Regel und Ausweispflicht. Den Sitzplan für die Fahrgäste lädt
 * nach den Fahrgastdaten eine Server Action.
 */
export default async function TripPage({ params, searchParams }: PageProps): Promise<ReactNode> {
  const { locale: rawLocale, tripId } = await params;
  const locale = rawLocale as Locale;
  setRequestLocale(locale);
  const t = await getTranslations('trip');
  const query = parseSeatPageQuery(await searchParams);

  if (query === null || !isUuid(tripId)) {
    const tInvalid = await getTranslations('invalidSearch');
    return (
      <Shell>
        <p role="alert" className="rounded-lg bg-amber-50 p-4 text-amber-900">
          {tInvalid('invalid')}
        </p>
        <Link href="/" className={LINK_BUTTON}>
          {tInvalid('back')}
        </Link>
      </Shell>
    );
  }

  const result = await apiSend<SeatMapResponse>(`/trips/${tripId}/seat-map`, {
    method: 'POST',
    body: { fromStopId: query.fromStopId, toStopId: query.toStopId },
  });
  if (!result.ok) {
    const tInvalid = await getTranslations('invalidSearch');
    return (
      <Shell>
        <ProblemNotice code={result.problem.code}>
          <Link href="/" className={`${LINK_BUTTON} bg-white`}>
            {tInvalid('back')}
          </Link>
        </ProblemNotice>
      </Shell>
    );
  }

  const seatMap = result.data;
  const departureAt = seatMap.from.departureAt;
  const arrivalAt = seatMap.to.arrivalAt;
  const days = departureAt === null ? 0 : arrivalDayOffset(departureAt, arrivalAt);
  const backHref =
    departureAt === null
      ? '/'
      : searchHref({
          from: seatMap.from.cityId,
          to: seatMap.to.cityId,
          date: localDateInDamascus(departureAt),
          passengers: query.passengers,
        });

  return (
    <Shell>
      <Link href={backHref} className={LINK_BUTTON}>
        {t('backToResults')}
      </Link>
      <section className="flex flex-col gap-2 rounded-lg border border-brand-100 bg-white p-4">
        <h1 className="text-xl font-bold leading-tight">
          {(await getTranslations('results'))('title', {
            from: localizedName(seatMap.from, locale),
            to: localizedName(seatMap.to, locale),
          })}
        </h1>
        <p className="font-medium">{localizedName(seatMap.company, locale)}</p>
        {departureAt === null ? null : (
          <p className="text-slate-700">
            {formatDate(departureAt, locale, 'full')} ·{' '}
            <time dateTime={departureAt}>{formatTime(departureAt, locale)}</time>
            {arrivalAt === null ? null : (
              <>
                {' – '}
                <time dateTime={arrivalAt}>{formatTime(arrivalAt, locale)}</time>
                {days > 0 ? (
                  <span className="ms-1 text-xs font-semibold text-amber-700">
                    {(await getTranslations('results')).rich('nextDayArrival', {
                      days: String(days),
                      n: (chunks) => <bdi dir="ltr">{chunks}</bdi>,
                    })}
                  </span>
                ) : null}
              </>
            )}
          </p>
        )}
        <p className="text-slate-700">
          {t('perPerson', { price: formatFare(seatMap.fare, locale) })}
        </p>
      </section>
      <BookingFlow
        tripId={tripId}
        fromStopId={query.fromStopId}
        toStopId={query.toStopId}
        passengers={query.passengers}
        genderRuleEnabled={seatMap.genderRule.enabled}
        nationalIdRequired={seatMap.nationalIdRequired}
        companyName={localizedName(seatMap.company, locale)}
      />
      <noscript>
        <p className="rounded-lg bg-amber-50 p-4 text-amber-900">{t('noScript')}</p>
      </noscript>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }): ReactNode {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pt-6 pb-12">
        {children}
      </main>
    </>
  );
}
