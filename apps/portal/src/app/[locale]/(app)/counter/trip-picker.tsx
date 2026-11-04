'use client';

import { formatTime, type Locale } from '@masar/shared';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { localName } from '../../../../lib/routes';
import type { CounterState } from './use-counter';

const CONTROL =
  'rounded-lg border border-slate-300 bg-white px-3 py-2 text-start focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200';

/** Schritte 1 und 2: Tag, Strecke und Fahrt wählen, dann Einstieg und Ausstieg. Nur Anzeige. */
export function TripPicker({ counter }: { counter: CounterState }): ReactNode {
  const t = useTranslations('counter');
  const locale = useLocale() as Locale;
  const { map } = counter;

  return (
    <div className="flex flex-col gap-4">
      <section
        aria-labelledby="counter-trip"
        className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4"
      >
        <h2 id="counter-trip" className="text-lg font-semibold">
          {t('trip.heading')}
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('trip.day')}</span>
            <input
              value={counter.day}
              onChange={(event) => counter.chooseDay(event.currentTarget.value)}
              dir="ltr"
              inputMode="numeric"
              placeholder="YYYY-MM-DD"
              autoComplete="off"
              className={CONTROL}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('trip.route')}</span>
            <select
              value={counter.routeId}
              onChange={(event) => counter.chooseRoute(event.currentTarget.value)}
              className={CONTROL}
            >
              <option value="">{t('trip.allRoutes')}</option>
              {counter.routes.map((route) => (
                <option key={route.id} value={route.id}>
                  {localName(route, locale)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('trip.trip')}</span>
            <select
              value={counter.tripId}
              onChange={(event) => counter.chooseTrip(event.currentTarget.value)}
              disabled={counter.trips === undefined || counter.trips.length === 0}
              className={CONTROL}
            >
              <option value="">{t('trip.choose')}</option>
              {(counter.trips ?? []).map((trip) => (
                <option key={trip.id} value={trip.id}>
                  {t('trip.option', {
                    time: formatTime(trip.departureAt, locale),
                    route: localName(trip.route, locale),
                  })}
                </option>
              ))}
            </select>
          </label>
        </div>
        {counter.trips === undefined ? (
          <p className="text-sm text-slate-600">{t('loading')}</p>
        ) : counter.trips.length === 0 ? (
          <p className="text-sm text-slate-600">{t('trip.none')}</p>
        ) : null}
      </section>

      {map === undefined ? null : (
        <section
          aria-labelledby="counter-stops"
          className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4"
        >
          <h2 id="counter-stops" className="text-lg font-semibold">
            {t('stops.heading')}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">{t('stops.from')}</span>
              <select
                value={map.from.tripStopId}
                onChange={(event) =>
                  counter.chooseStops(event.currentTarget.value, map.to.tripStopId)
                }
                className={CONTROL}
              >
                {map.trip.stops.slice(0, -1).map((stop) => (
                  <option key={stop.tripStopId} value={stop.tripStopId}>
                    {localName(stop, locale)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">{t('stops.to')}</span>
              <select
                value={map.to.tripStopId}
                onChange={(event) =>
                  counter.chooseStops(map.from.tripStopId, event.currentTarget.value)
                }
                className={CONTROL}
              >
                {map.trip.stops
                  .filter((stop) => stop.seq > map.from.seq)
                  .map((stop) => (
                    <option key={stop.tripStopId} value={stop.tripStopId}>
                      {localName(stop, locale)}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          {map.from.departureAt === null ? null : (
            <p className="text-sm text-slate-600 tabular-nums">
              {t('stops.departure', { time: formatTime(map.from.departureAt, locale) })}
            </p>
          )}
          {map.salesOpen ? null : (
            <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              {t('stops.closed')}
            </p>
          )}
          {map.fare === null ? (
            <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              {t('stops.noFare')}
            </p>
          ) : null}
        </section>
      )}
    </div>
  );
}
