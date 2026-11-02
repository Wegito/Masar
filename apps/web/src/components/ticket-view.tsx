'use client';

import { formatBookingCode, formatDate, formatTime, type Locale } from '@masar/shared';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useState } from 'react';

import { loadTicket, type TicketLoadResult } from '../app/[locale]/bookings/[bookingId]/actions';
import { Link } from '../i18n/navigation';
import { formatFare, localizedName } from '../lib/format';
import { forgetOffline, prepareOffline } from '../lib/offline';
import {
  parseCopy,
  statusNotice,
  storageKey,
  type TicketCopy,
  type TicketData,
  tokenFromFragment,
} from '../lib/ticket';
import type { BookingStatus, TicketStopView } from '../lib/types';
import { QrCode } from './qr-code';

type ViewState =
  | { phase: 'loading' }
  | { phase: 'missing' }
  | { phase: 'error'; code: string }
  | { phase: 'forgotten' }
  | {
      phase: 'ready';
      copy: TicketCopy;
      /** `fresh`: gerade geladen; sonst die gespeicherte Kopie und warum. */
      source: 'fresh' | 'offline' | 'refreshFailed' | 'noToken';
    };

/** Farbe und Rahmen je Status; Text steht immer daneben, die Farbe trägt nichts allein. */
const STATUS_CLASSES: Record<BookingStatus, string> = {
  HELD: 'bg-amber-100 text-amber-900',
  RESERVED: 'bg-amber-100 text-amber-900',
  PENDING_CONFIRMATION: 'bg-sky-100 text-sky-900',
  CONFIRMED: 'bg-emerald-100 text-emerald-900',
  CANCELLED: 'bg-slate-200 text-slate-800',
  EXPIRED: 'bg-slate-200 text-slate-800',
};

const BUTTON =
  'rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600';

function readCopy(bookingId: string): TicketCopy | null {
  try {
    return parseCopy(window.localStorage.getItem(storageKey(bookingId)), bookingId);
  } catch {
    // Gesperrter Speicher (privater Modus): dann ohne Kopie.
    return null;
  }
}

function writeCopy(copy: TicketCopy): void {
  try {
    window.localStorage.setItem(storageKey(copy.ticket.id), JSON.stringify(copy));
  } catch {
    // Voll oder gesperrt: Die Seite funktioniert weiter, nur nicht offline.
  }
}

/**
 * Ticketseite im Browser (Schritt 1.4, ADR 0022). Das Token steht nur im Fragment (`#token=`) und
 * geht per Server Action im POST-Body an den Web-Server, nie in eine URL. Die zuletzt geladene
 * Ansicht liegt im localStorage (ohne Token); ohne Netz zeigt die Seite diese Kopie mit Hinweis.
 */
export function TicketView({ bookingId }: { bookingId: string }): ReactNode {
  const t = useTranslations('ticket');
  const [state, setState] = useState<ViewState>({ phase: 'loading' });
  const [offlineReady, setOfflineReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const saved = readCopy(bookingId);
      const token = tokenFromFragment(window.location.hash);
      if (token === null) {
        setState(
          saved === null
            ? { phase: 'missing' }
            : { phase: 'ready', copy: saved, source: 'noToken' },
        );
        return;
      }
      if (saved !== null) {
        // Sofort etwas zeigen; das Netz kann langsam sein.
        setState({ phase: 'ready', copy: saved, source: 'offline' });
      }
      let result: TicketLoadResult;
      try {
        result = await loadTicket(bookingId, token);
      } catch {
        result = { status: 'error', code: 'NETWORK_ERROR' };
      }
      if (cancelled) {
        return;
      }
      if (result.status === 'ok') {
        const copy: TicketCopy = { version: 1, savedAt: result.loadedAt, ticket: result.ticket };
        writeCopy(copy);
        setState({ phase: 'ready', copy, source: 'fresh' });
        prepareOffline()
          .then((ready) => {
            if (!cancelled) setOfflineReady(ready);
          })
          .catch(() => undefined);
        return;
      }
      if (saved !== null) {
        setState({
          phase: 'ready',
          copy: saved,
          source: result.code === 'NETWORK_ERROR' ? 'offline' : 'refreshFailed',
        });
        return;
      }
      setState({ phase: 'error', code: result.code });
    })();
    return () => {
      cancelled = true;
    };
  }, [bookingId]);

  function forget(): void {
    try {
      window.localStorage.removeItem(storageKey(bookingId));
    } catch {
      // Nichts gespeichert.
    }
    void forgetOffline(window.location.pathname).catch(() => undefined);
    setState({ phase: 'forgotten' });
  }

  switch (state.phase) {
    case 'loading':
      return (
        <p role="status" className="rounded-xl bg-slate-50 p-4 text-slate-700">
          {t('loading')}
        </p>
      );
    case 'missing':
    case 'error':
    case 'forgotten':
      return (
        <div role="alert" className="flex flex-col gap-3 rounded-xl bg-amber-50 p-4 text-amber-900">
          <p>
            {state.phase === 'missing'
              ? t('missingToken')
              : state.phase === 'forgotten'
                ? t('forgotten')
                : t(
                    state.code === 'NETWORK_ERROR'
                      ? 'networkError'
                      : state.code === 'RATE_LIMITED'
                        ? 'rateLimited'
                        : 'notFound',
                  )}
          </p>
          <Link href="/my-booking" prefetch={false} className={`${BUTTON} self-start bg-white`}>
            {t('openBooking')}
          </Link>
        </div>
      );
    case 'ready':
      return (
        <div data-offline-ready={offlineReady ? 'true' : undefined} className="flex flex-col gap-6">
          {state.source === 'fresh' ? null : (
            <SavedCopyNotice copy={state.copy} source={state.source} />
          )}
          <Ticket ticket={state.copy.ticket} />
          <div className="flex flex-wrap gap-3 print:hidden">
            <button type="button" className={BUTTON} onClick={() => window.print()}>
              {t('print')}
            </button>
            <button type="button" className={BUTTON} onClick={forget}>
              {t('forget')}
            </button>
          </div>
          <p className="text-sm text-slate-600 print:hidden">{t('savedHint')}</p>
        </div>
      );
  }
}

function SavedCopyNotice({
  copy,
  source,
}: {
  copy: TicketCopy;
  source: 'offline' | 'refreshFailed' | 'noToken';
}): ReactNode {
  const t = useTranslations('ticket');
  const locale = useLocale() as Locale;
  const values = {
    date: formatDate(copy.savedAt, locale, 'long'),
    time: formatTime(copy.savedAt, locale),
  };
  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-xl bg-sky-50 p-4 text-sky-900 print:hidden"
    >
      <p>{t(source === 'offline' ? 'savedOffline' : 'savedStale', values)}</p>
      {source === 'offline' ? null : (
        <Link href="/my-booking" prefetch={false} className={`${BUTTON} self-start bg-white`}>
          {t('openBooking')}
        </Link>
      )}
    </div>
  );
}

function stopTime(stop: TicketStopView): string | null {
  return stop.departureAt ?? stop.arrivalAt;
}

function Ticket({ ticket }: { ticket: TicketData }): ReactNode {
  const t = useTranslations('ticket');
  const locale = useLocale() as Locale;
  const notice = statusNotice(ticket);
  const departureAt = ticket.from.departureAt ?? ticket.trip.departureAt;
  const arrivalAt = ticket.to.arrivalAt;
  const company = localizedName(ticket.trip.company, locale);
  const noticeText = ((): string => {
    switch (notice.key) {
      case 'held':
      case 'reservedCash':
        return notice.until === null
          ? t(`notice.${notice.key}NoDeadline`, {
              total: formatFare(ticket.total, locale),
              company,
            })
          : t(`notice.${notice.key}`, {
              total: formatFare(ticket.total, locale),
              company,
              date: formatDate(notice.until, locale, 'full'),
              time: formatTime(notice.until, locale),
            });
      case 'pending':
      case 'confirmed':
      case 'tripCancelled':
      case 'cancelled':
      case 'expired':
        return t(`notice.${notice.key}`);
    }
  })();

  return (
    <article className="flex flex-col gap-6 rounded-2xl border border-slate-200 p-4 print:border-0 print:p-0">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-bold">{t('title')}</h1>
          <span
            className={`rounded-full px-3 py-1 text-sm font-semibold ${STATUS_CLASSES[ticket.status]}`}
          >
            {t(`status.${ticket.status}`)}
          </span>
        </div>
        <p className="flex flex-wrap items-baseline gap-2">
          <span className="text-slate-700">{t('bookingCode')}</span>
          <bdi
            dir="ltr"
            lang="en"
            translate="no"
            className="font-mono text-2xl font-bold tracking-wider"
          >
            {formatBookingCode(ticket.bookingCode)}
          </bdi>
        </p>
        <p className="rounded-xl bg-slate-50 p-3 text-slate-800 print:bg-white print:p-0">
          {noticeText}
        </p>
      </header>

      <section aria-labelledby="ticket-trip" className="flex flex-col gap-2">
        <h2 id="ticket-trip" className="text-lg font-semibold">
          {t('trip')}
        </h2>
        <p className="font-medium">{company}</p>
        <p>{formatDate(departureAt, locale, 'full')}</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-slate-600">{t('departure')}</dt>
          <dd>
            <time dateTime={departureAt} className="font-semibold">
              {formatTime(departureAt, locale)}
            </time>{' '}
            {localizedName(ticket.from, locale)}
          </dd>
          <dt className="text-slate-600">{t('arrival')}</dt>
          <dd>
            {arrivalAt === null ? null : (
              <>
                <time dateTime={arrivalAt} className="font-semibold">
                  {formatTime(arrivalAt, locale)}
                </time>{' '}
              </>
            )}
            {localizedName(ticket.to, locale)}
          </dd>
        </dl>
        {ticket.stops.length > 2 ? (
          <>
            <h3 className="mt-2 text-sm font-semibold text-slate-700">{t('stops')}</h3>
            <ol className="flex flex-col gap-1 border-s-2 border-slate-200 ps-3 text-sm">
              {ticket.stops.map((stop) => {
                const time = stopTime(stop);
                return (
                  <li key={stop.tripStopId}>
                    {time === null ? null : (
                      <time dateTime={time} className="me-2 tabular-nums">
                        {formatTime(time, locale)}
                      </time>
                    )}
                    {localizedName(stop, locale)}
                  </li>
                );
              })}
            </ol>
          </>
        ) : null}
        <p className="mt-2">{t('total', { price: formatFare(ticket.total, locale) })}</p>
      </section>

      <section aria-labelledby="ticket-passengers" className="flex flex-col gap-4">
        <h2 id="ticket-passengers" className="text-lg font-semibold">
          {t('passengers')}
        </h2>
        <ul className="flex flex-col gap-4">
          {ticket.passengers.map((passenger) => {
            const entry = ticket.tickets.find(
              (candidate) => candidate.passengerId === passenger.id,
            );
            return (
              <li
                key={passenger.id}
                className="flex flex-col items-center gap-3 rounded-xl border border-slate-200 p-4 text-center break-inside-avoid"
              >
                <p className="text-lg font-semibold">{passenger.fullName}</p>
                <p>{t('seat', { label: passenger.seatLabel })}</p>
                {entry === undefined ? (
                  <p className="text-sm text-slate-600">{t('noTicketYet')}</p>
                ) : (
                  <>
                    <p className="text-sm font-medium">{t(`ticketStatus.${entry.status}`)}</p>
                    {entry.qr === null ? null : (
                      <QrCode qr={entry.qr} label={t('qrLabel', { label: entry.seatLabel })} />
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </article>
  );
}
