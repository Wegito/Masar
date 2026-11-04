'use client';

import {
  BOOKING_CHANNELS,
  BOOKING_LIST_LIMITS,
  BOOKING_STATUSES,
  formatBookingCode,
  formatDateTime,
  type Locale,
  PAYMENT_METHODS,
} from '@masar/shared';
import { useLocale, useTranslations } from 'next-intl';
import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from 'react';

import { ProblemMessage } from '../../../../components/problem-message';
import { Link } from '../../../../i18n/navigation';
import { api, type Problem } from '../../../../lib/api';
import {
  BOOKING_STATUS_BADGE,
  type BookingFilters,
  type BookingListItem,
  bookingListQuery,
  EMPTY_FILTERS,
  formatTotal,
  PAYMENT_STATE_BADGE,
} from '../../../../lib/booking';
import { localName } from '../../../../lib/routes';

type Failure = { problem: Problem; retryAfterSeconds?: number };
type Page = { items: BookingListItem[]; nextCursor: string | null };

const PAGE_SIZE = 50;
const CONTROL =
  'rounded-lg border border-slate-300 bg-white px-3 py-2 text-start focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200';
const SECONDARY_BUTTON =
  'rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60';

/**
 * Liste der Buchungen (Schritt 2.5, ADR 0028) mit Filtern nach Tag, Status, Zahlweg, Kanal und
 * Freitext (Anfang des Codes oder Ende der Telefonnummer) sowie „mehr laden" über den Cursor.
 * Ab mittlerer Breite eine Tabelle, darunter Karten. Filter leben im Zustand der Seite; der
 * Suchtext geht nur an die API, nie in die Adresse der Seite. Die Fahrt kann aus der Adresse
 * kommen (Link aus der Fahrgastliste), weil ihre ID keine Personendaten trägt.
 */
export function BookingList({
  companyId,
  tripId,
}: {
  companyId: string;
  tripId?: string;
}): ReactNode {
  const t = useTranslations('bookings.list');
  const [draft, setDraft] = useState<BookingFilters>({ ...EMPTY_FILTERS, tripId: tripId ?? '' });
  const [filters, setFilters] = useState<BookingFilters>(draft);
  const [page, setPage] = useState<Page>();
  const [failure, setFailure] = useState<Failure>();
  const [dayInvalid, setDayInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const base = `/companies/${companyId}/bookings`;

  const load = useCallback(
    async (active: BookingFilters, cursor?: string): Promise<void> => {
      const query = bookingListQuery(active, {
        limit: PAGE_SIZE,
        ...(cursor === undefined ? {} : { cursor }),
      });
      if (query === null) {
        setDayInvalid(true);
        return;
      }
      setBusy(true);
      const result = await api<Page>(`${base}${query}`);
      setBusy(false);
      if (!result.ok) {
        setFailure(result);
        return;
      }
      setFailure(undefined);
      setPage((previous) =>
        cursor === undefined || previous === undefined
          ? result.data
          : {
              items: [...previous.items, ...result.data.items],
              nextCursor: result.data.nextCursor,
            },
      );
    },
    [base],
  );

  useEffect(() => {
    // Erstes Laden nach dem Einhängen; setState erst nach der Antwort der API.
    void load(filters);
  }, [load, filters]);

  function apply(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setDayInvalid(false);
    if (bookingListQuery(draft) === null) {
      setDayInvalid(true);
      return;
    }
    setPage(undefined);
    setFilters({ ...draft });
  }

  function reset(): void {
    setDayInvalid(false);
    setDraft({ ...EMPTY_FILTERS });
    setPage(undefined);
    // Neues Objekt, damit auch ein zweites Zurücksetzen neu lädt.
    setFilters({ ...EMPTY_FILTERS });
  }

  function change<K extends keyof BookingFilters>(field: K, value: BookingFilters[K]): void {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  return (
    <section aria-labelledby="list-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="list-heading" className="text-xl font-semibold">
          {t('title')}
        </h2>
        <p className="text-sm text-slate-600">
          {filters.day === '' && filters.tripId === '' && filters.q === ''
            ? t('rangeUpcoming')
            : t('rangeFiltered')}
        </p>
      </div>
      <form
        onSubmit={apply}
        aria-label={t('filters')}
        className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t('q')}</span>
          <input
            value={draft.q}
            onChange={(event) => change('q', event.currentTarget.value)}
            dir="ltr"
            autoComplete="off"
            spellCheck={false}
            maxLength={BOOKING_LIST_LIMITS.maxQueryLength}
            className={CONTROL}
          />
          <span className="text-xs text-slate-500">{t('qHint')}</span>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t('day')}</span>
          <input
            value={draft.day}
            onChange={(event) => change('day', event.currentTarget.value)}
            dir="ltr"
            inputMode="numeric"
            placeholder="YYYY-MM-DD"
            autoComplete="off"
            aria-invalid={dayInvalid}
            className={CONTROL}
          />
          <span className={`text-xs ${dayInvalid ? 'text-red-700' : 'text-slate-500'}`}>
            {dayInvalid ? t('dayInvalid') : t('dayHint')}
          </span>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t('status')}</span>
          <select
            value={draft.status}
            onChange={(event) =>
              change('status', event.currentTarget.value as BookingFilters['status'])
            }
            className={CONTROL}
          >
            <option value="">{t('all')}</option>
            {BOOKING_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(`statuses.${status}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t('paymentMethod')}</span>
          <select
            value={draft.paymentMethod}
            onChange={(event) =>
              change('paymentMethod', event.currentTarget.value as BookingFilters['paymentMethod'])
            }
            className={CONTROL}
          >
            <option value="">{t('all')}</option>
            {PAYMENT_METHODS.map((method) => (
              <option key={method} value={method}>
                {t(`paymentMethods.${method}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t('channel')}</span>
          <select
            value={draft.channel}
            onChange={(event) =>
              change('channel', event.currentTarget.value as BookingFilters['channel'])
            }
            className={CONTROL}
          >
            <option value="">{t('all')}</option>
            {BOOKING_CHANNELS.map((channel) => (
              <option key={channel} value={channel}>
                {t(`channels.${channel}`)}
              </option>
            ))}
          </select>
        </label>
        {draft.tripId === '' ? null : (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('trip')}</span>
            <span className="flex items-center gap-2">
              <span className="text-sm text-slate-700">{t('tripSelected')}</span>
              <button
                type="button"
                className={SECONDARY_BUTTON}
                onClick={() => change('tripId', '')}
              >
                {t('tripClear')}
              </button>
            </span>
          </div>
        )}
        <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-3">
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-brand-600 px-4 py-2 font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {t('apply')}
          </button>
          <button type="button" className={SECONDARY_BUTTON} onClick={reset}>
            {t('reset')}
          </button>
        </div>
      </form>
      {failure === undefined ? null : <ListProblem failure={failure} />}
      {page === undefined ? (
        failure === undefined ? (
          <p className="text-slate-600">{t('loading')}</p>
        ) : null
      ) : page.items.length === 0 ? (
        <p className="text-slate-600">{t('empty')}</p>
      ) : (
        <Results items={page.items} />
      )}
      {page?.nextCursor ? (
        <div>
          <button
            type="button"
            disabled={busy}
            className={SECONDARY_BUTTON}
            onClick={() => void load(filters, page.nextCursor ?? undefined)}
          >
            {t('more')}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function ListProblem({ failure }: { failure: Failure }): ReactNode {
  const t = useTranslations('bookings.list');
  if (failure.problem.code === 'BOOKING_SEARCH_INVALID') {
    return (
      <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
        {t('searchInvalid')}
      </p>
    );
  }
  return <ProblemMessage {...failure} />;
}

/** Tabelle ab mittlerer Breite, Karten darunter; beide aus denselben Einträgen. */
function Results({ items }: { items: BookingListItem[] }): ReactNode {
  const t = useTranslations('bookings.list');
  const tb = useTranslations('bookings');
  const locale = useLocale() as Locale;
  const departure = (item: BookingListItem): string =>
    formatDateTime(item.from.departureAt ?? item.trip.departureAt, locale);
  const segment = (item: BookingListItem): string =>
    tb('route', { from: localName(item.from, locale), to: localName(item.to, locale) });
  const code = (item: BookingListItem): ReactNode => (
    <bdi dir="ltr" translate="no" className="font-mono">
      {formatBookingCode(item.bookingCode)}
    </bdi>
  );
  const badges = (item: BookingListItem): ReactNode => (
    <span className="flex flex-wrap gap-1">
      <span
        className={`rounded-full px-2 py-0.5 text-xs font-medium ${BOOKING_STATUS_BADGE[item.status]}`}
      >
        {t(`statuses.${item.status}`)}
      </span>
      <span
        className={`rounded-full px-2 py-0.5 text-xs font-medium ${PAYMENT_STATE_BADGE[item.paymentState]}`}
      >
        {tb(`paymentStates.${item.paymentState}`)}
      </span>
    </span>
  );
  const open = (item: BookingListItem): ReactNode => (
    <Link
      href={`/bookings/${item.id}`}
      className="font-medium text-brand-700 underline-offset-2 hover:underline"
    >
      {t('open')}
      <span className="sr-only"> {formatBookingCode(item.bookingCode)}</span>
    </Link>
  );

  return (
    <>
      <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white md:block">
        <table className="w-full text-sm">
          <caption className="sr-only">{t('title')}</caption>
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th scope="col" className="px-3 py-2 text-start font-medium">
                {t('columns.departure')}
              </th>
              <th scope="col" className="px-3 py-2 text-start font-medium">
                {t('columns.trip')}
              </th>
              <th scope="col" className="px-3 py-2 text-start font-medium">
                {t('columns.code')}
              </th>
              <th scope="col" className="px-3 py-2 text-start font-medium">
                {t('columns.contact')}
              </th>
              <th scope="col" className="px-3 py-2 text-end font-medium">
                {t('columns.passengers')}
              </th>
              <th scope="col" className="px-3 py-2 text-start font-medium">
                {t('columns.status')}
              </th>
              <th scope="col" className="px-3 py-2 text-end font-medium">
                {t('columns.total')}
              </th>
              <th scope="col" className="px-3 py-2 text-start font-medium">
                <span className="sr-only">{t('open')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} data-booking-id={item.id} className="border-t border-slate-100">
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">{departure(item)}</td>
                <td className="px-3 py-2">
                  <span className="block">{localName(item.trip.route, locale)}</span>
                  <span className="block text-slate-600">{segment(item)}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2">{code(item)}</td>
                <td className="px-3 py-2">
                  <span className="block">{item.contact.name}</span>
                  <bdi
                    dir="ltr"
                    translate="no"
                    className="block whitespace-nowrap tabular-nums text-slate-600"
                  >
                    {item.contact.phoneMasked}
                  </bdi>
                </td>
                <td className="px-3 py-2 text-end tabular-nums">{item.passengerCount}</td>
                <td className="px-3 py-2">{badges(item)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-end tabular-nums">
                  {formatTotal(item.total, locale)}
                </td>
                <td className="whitespace-nowrap px-3 py-2">{open(item)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="flex flex-col gap-2 md:hidden" aria-label={t('title')}>
        {items.map((item) => (
          <li
            key={item.id}
            data-booking-id={item.id}
            className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold tabular-nums">{departure(item)}</span>
              {code(item)}
            </div>
            <p className="text-sm text-slate-700">
              {localName(item.trip.route, locale)} · {segment(item)}
            </p>
            <p className="flex flex-wrap gap-x-2 text-sm">
              <span>{item.contact.name}</span>
              <bdi
                dir="ltr"
                translate="no"
                className="whitespace-nowrap tabular-nums text-slate-600"
              >
                {item.contact.phoneMasked}
              </bdi>
            </p>
            <div className="flex flex-wrap items-center justify-between gap-2">
              {badges(item)}
              <span className="text-sm tabular-nums">
                {t('passengerCount', { count: String(item.passengerCount) })} ·{' '}
                {formatTotal(item.total, locale)}
              </span>
            </div>
            <div>{open(item)}</div>
          </li>
        ))}
      </ul>
    </>
  );
}
