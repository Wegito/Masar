'use client';

import { formatDateTime, formatTime, type Locale } from '@masar/shared';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useState } from 'react';

import { ProblemMessage } from '../../../../../../components/problem-message';
import { Link } from '../../../../../../i18n/navigation';
import { api, type Problem } from '../../../../../../lib/api';
import {
  BOOKING_STATUS_BADGE,
  PAYMENT_STATE_BADGE,
  type StaffStop,
  type TripPassenger,
  type TripPassengers,
} from '../../../../../../lib/booking';
import { localName } from '../../../../../../lib/routes';

type Failure = { problem: Problem; retryAfterSeconds?: number };

function stopTime(stop: StaffStop, locale: Locale): string {
  const time = stop.departureAt ?? stop.arrivalAt;
  return time === null ? '–' : formatTime(time, locale);
}

/**
 * Lädt die Fahrgastliste über die API. Tabelle ab mittlerer Breite, Karten darunter (Fahrer am
 * Telefon). Zeiten in Damaskus mit westlichen Ziffern. Personendaten bleiben im Speicher der Seite.
 */
export function PassengerList({
  companyId,
  tripId,
  canOpenBookings,
}: {
  companyId: string;
  tripId: string;
  canOpenBookings: boolean;
}): ReactNode {
  const t = useTranslations('passengers');
  const tb = useTranslations('bookings');
  const locale = useLocale() as Locale;
  const [data, setData] = useState<TripPassengers>();
  const [failure, setFailure] = useState<Failure>();

  useEffect(() => {
    let active = true;
    void api<TripPassengers>(`/companies/${companyId}/trips/${tripId}/passengers`).then(
      (result) => {
        if (!active) return;
        if (result.ok) {
          setData(result.data);
        } else {
          setFailure(result);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [companyId, tripId]);

  if (failure !== undefined) {
    return failure.problem.code === 'TRIP_NOT_FOUND' ? (
      <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
        {t('notFound')}
      </p>
    ) : (
      <ProblemMessage {...failure} />
    );
  }
  if (data === undefined) {
    return <p className="text-slate-600">{t('loading')}</p>;
  }
  const { trip, items, summary } = data;
  const counts = new Map(summary.perStop.map((stop) => [stop.tripStopId, stop]));
  const stopLabel = (stop: StaffStop): string =>
    `${localName(stop, locale)} (${stopTime(stop, locale)})`;
  const status = (item: TripPassenger): ReactNode => (
    <span className="flex flex-wrap gap-1">
      <span
        className={`rounded-full px-2 py-0.5 text-xs font-medium ${BOOKING_STATUS_BADGE[item.bookingStatus]}`}
      >
        {tb(`list.statuses.${item.bookingStatus}`)}
      </span>
      <span
        className={`rounded-full px-2 py-0.5 text-xs font-medium ${PAYMENT_STATE_BADGE[item.paymentState]}`}
      >
        {tb(`paymentStates.${item.paymentState}`)}
      </span>
    </span>
  );
  const person = (item: TripPassenger): string =>
    [
      item.gender === null ? null : tb(`genders.${item.gender}`),
      item.nationalIdPresent ? tb('nationalIdPresent') : tb('nationalIdMissing'),
    ]
      .filter((part) => part !== null)
      .join(' · ');
  const open = (item: TripPassenger): ReactNode =>
    canOpenBookings ? (
      <Link
        href={`/bookings/${item.bookingId}`}
        className="font-medium text-brand-700 hover:underline"
      >
        {t('openBooking')}
        <span className="sr-only"> {t('seat', { label: item.seatLabel })}</span>
      </Link>
    ) : null;

  return (
    <div className="flex flex-col gap-6">
      <section
        aria-labelledby="trip-heading"
        className="flex flex-col gap-3 rounded-md border border-brand-100 bg-white p-4"
      >
        <h2 id="trip-heading" className="text-lg font-semibold">
          {localName(trip.route, locale)}
        </h2>
        <p className="tabular-nums text-slate-700">
          {formatDateTime(trip.departureAt, locale)}
          {trip.bus === null ? null : ` · ${t('bus', { plate: trip.bus.plate })}`}
        </p>
        <p className="tabular-nums" data-testid="passenger-summary">
          {t('summary', {
            passengers: String(summary.passengers),
            paid: String(summary.paid),
            open: String(summary.open),
          })}
        </p>
        <ol className="flex flex-col gap-1 text-sm">
          {trip.stops.map((stop) => {
            const count = counts.get(stop.tripStopId);
            return (
              <li key={stop.tripStopId} className="flex flex-wrap gap-x-3">
                <span className="min-w-14 tabular-nums">{stopTime(stop, locale)}</span>
                <span>{localName(stop, locale)}</span>
                <span className="tabular-nums text-slate-500">
                  {t('perStop', {
                    boarding: String(count?.boarding ?? 0),
                    alighting: String(count?.alighting ?? 0),
                  })}
                </span>
              </li>
            );
          })}
        </ol>
        {canOpenBookings ? (
          <p>
            <Link
              href={`/bookings?tripId=${trip.id}`}
              className="text-sm font-medium text-brand-700 hover:underline"
            >
              {t('allBookings')}
            </Link>
          </p>
        ) : null}
      </section>
      {items.length === 0 ? (
        <p className="text-slate-600">{t('empty')}</p>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-md border border-brand-100 bg-white md:block">
            <table className="w-full text-sm">
              <caption className="sr-only">{t('title')}</caption>
              <thead className="bg-brand-50 text-slate-600">
                <tr>
                  <th scope="col" className="px-3 py-2 text-start font-medium">
                    {t('columns.seat')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">
                    {t('columns.name')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">
                    {t('columns.boarding')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">
                    {t('columns.alighting')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">
                    {t('columns.status')}
                  </th>
                  {canOpenBookings ? (
                    <th scope="col" className="px-3 py-2 text-start font-medium">
                      <span className="sr-only">{t('openBooking')}</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.passengerId}
                    data-seat={item.seatLabel}
                    className="border-t border-slate-100"
                  >
                    <td className="px-3 py-2 font-semibold">
                      <bdi dir="ltr">{item.seatLabel}</bdi>
                    </td>
                    <td className="px-3 py-2">
                      <span className="block">{item.fullName}</span>
                      <span className="block text-slate-600">{person(item)}</span>
                    </td>
                    <td className="px-3 py-2">{stopLabel(item.from)}</td>
                    <td className="px-3 py-2">{stopLabel(item.to)}</td>
                    <td className="px-3 py-2">{status(item)}</td>
                    {canOpenBookings ? <td className="px-3 py-2">{open(item)}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="flex flex-col gap-2 md:hidden" aria-label={t('title')}>
            {items.map((item) => (
              <li
                key={item.passengerId}
                data-seat={item.seatLabel}
                className="flex flex-col gap-1 rounded-md border border-brand-100 bg-white p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">{t('seat', { label: item.seatLabel })}</span>
                  {status(item)}
                </div>
                <span>{item.fullName}</span>
                <span className="text-sm text-slate-600">{person(item)}</span>
                <span className="text-sm">
                  {t('segment', { from: stopLabel(item.from), to: stopLabel(item.to) })}
                </span>
                {open(item)}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
