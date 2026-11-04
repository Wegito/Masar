'use client';

import { formatDate, formatTime, type Locale } from '@masar/shared';
import { useLocale, useTranslations } from 'next-intl';
import {
  type FormEvent,
  type ReactNode,
  startTransition,
  useActionState,
  useEffect,
  useState,
} from 'react';

import {
  type CheckoutData,
  loadCheckout,
  type CheckoutLoadResult,
  reserveCash,
  type ReserveState,
} from '../app/[locale]/bookings/[bookingId]/pay/actions';
import { Link } from '../i18n/navigation';
import { checkoutStep, formatCountdown, remainingSeconds } from '../lib/booking';
import { formatFare, localizedName } from '../lib/format';
import { seatPageHref } from '../lib/search';
import { ticketHref, tokenFromFragment } from '../lib/ticket';
import { ProblemNotice } from './problem-notice';

type ViewState =
  | { phase: 'loading' }
  | { phase: 'missing' }
  | { phase: 'error'; code: string }
  | { phase: 'redirect' }
  | {
      phase: 'ready';
      booking: CheckoutData;
      token: string;
      serverNow: string;
      /** Geräteuhr beim Laden; zusammen mit `serverNow` für den Countdown. */
      loadedAt: number;
    };

const BUTTON =
  'self-start rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600';

const initialReserve: ReserveState = { status: 'idle' };

/**
 * „Zahlweg wählen" im Browser (Schritt 1.5). Liest das Verwaltungstoken aus dem Fragment, lädt die
 * gehaltene Buchung per Server Action und zeigt die Restzeit des Holds. Barzahlung reserviert die
 * Buchung bis zur Barfrist; danach öffnet sich die Ticketseite, das Token wieder nur im Fragment.
 * Online-Zahlung kommt mit Phase 3 und erscheint bis dahin nicht als Option.
 */
export function CheckoutView({ bookingId }: { bookingId: string }): ReactNode {
  const t = useTranslations('checkout');
  const locale = useLocale() as Locale;
  const [state, setState] = useState<ViewState>({ phase: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const token = tokenFromFragment(window.location.hash);
      if (token === null) {
        setState({ phase: 'missing' });
        return;
      }
      let result: CheckoutLoadResult;
      try {
        result = await loadCheckout(bookingId, token);
      } catch {
        result = { status: 'error', code: 'NETWORK_ERROR' };
      }
      if (cancelled) {
        return;
      }
      if (result.status === 'error') {
        setState({ phase: 'error', code: result.code });
        return;
      }
      if (checkoutStep(result.booking.status) === 'ticket') {
        // Schon reserviert oder bezahlt: Hier gibt es nichts mehr zu wählen.
        setState({ phase: 'redirect' });
        window.location.replace(ticketHref(locale, bookingId, token));
        return;
      }
      setState({
        phase: 'ready',
        booking: result.booking,
        token,
        serverNow: result.serverNow,
        loadedAt: Date.now(),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [bookingId, locale]);

  switch (state.phase) {
    case 'loading':
    case 'redirect':
      return (
        <p role="status" className="rounded-lg bg-white p-4 text-slate-700">
          {t(state.phase === 'loading' ? 'loading' : 'openingTicket')}
        </p>
      );
    case 'missing':
    case 'error':
      return (
        <div role="alert" className="flex flex-col gap-3 rounded-lg bg-amber-50 p-4 text-amber-900">
          <p>
            {state.phase === 'missing'
              ? t('missingToken')
              : state.code === 'NETWORK_ERROR' || state.code === 'RATE_LIMITED'
                ? t(state.code === 'NETWORK_ERROR' ? 'networkError' : 'rateLimited')
                : t('notFound')}
          </p>
          <Link href="/my-booking" prefetch={false} className={BUTTON}>
            {t('openBooking')}
          </Link>
        </div>
      );
    case 'ready':
      return <Checkout {...state} />;
  }
}

function Checkout({
  booking,
  token,
  serverNow,
  loadedAt,
}: Extract<ViewState, { phase: 'ready' }>): ReactNode {
  const t = useTranslations('checkout');
  const locale = useLocale() as Locale;
  const [now, setNow] = useState(loadedAt);
  const [reserve, formAction, pending] = useActionState(reserveCash, initialReserve);
  const step = checkoutStep(booking.status);
  const remaining =
    booking.holdExpiresAt === null
      ? null
      : remainingSeconds(booking.holdExpiresAt, serverNow, loadedAt, now);
  const expired =
    step === 'expired' ||
    remaining === 0 ||
    (reserve.status === 'error' && reserve.code === 'HOLD_EXPIRED');
  const reserved = reserve.status === 'reserved';
  const href = ticketHref(locale, booking.id, token);

  useEffect(() => {
    if (expired || reserved) {
      return;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [expired, reserved]);

  useEffect(() => {
    if (reserved) {
      // Volle Navigation: Die Ticketseite liest das Token aus dem Fragment.
      window.location.assign(href);
    }
  }, [reserved, href]);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  }

  const company = localizedName(booking.trip.company, locale);
  const departureAt = booking.from.departureAt ?? booking.trip.departureAt;
  const total = formatFare(booking.total, locale);
  const againHref = seatPageHref(booking.trip.id, {
    fromStopId: booking.from.tripStopId,
    toStopId: booking.to.tripStopId,
    passengers: Math.max(1, booking.passengers.length),
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">{t('title')}</h1>

      {step === 'cancelled' || expired ? (
        <div role="alert" className="flex flex-col gap-3 rounded-lg bg-amber-50 p-4 text-amber-900">
          <p>{t(step === 'cancelled' ? 'cancelled' : 'expired')}</p>
          <Link href={againHref} prefetch={false} className={BUTTON}>
            {t('chooseAgain')}
          </Link>
        </div>
      ) : remaining === null ? null : (
        <div className="flex flex-col gap-1 rounded-lg bg-amber-50 p-4 text-amber-950">
          <p>
            {t.rich('heldFor', {
              countdown: formatCountdown(remaining),
              time: formatTime(booking.holdExpiresAt ?? '', locale),
              timer: (chunks) => (
                <bdi dir="ltr" role="timer" className="text-xl font-bold tabular-nums">
                  {chunks}
                </bdi>
              ),
            })}
          </p>
          {remaining <= 60 ? (
            <p role="status" className="text-sm font-semibold">
              {t('lastMinute')}
            </p>
          ) : null}
        </div>
      )}

      <section aria-labelledby="checkout-trip" className="flex flex-col gap-2">
        <h2 id="checkout-trip" className="text-lg font-semibold">
          {t('tripHeading')}
        </h2>
        <p className="font-medium">{company}</p>
        <p>
          {t('route', {
            from: localizedName(booking.from, locale),
            to: localizedName(booking.to, locale),
          })}
        </p>
        <p>
          {formatDate(departureAt, locale, 'full')} ·{' '}
          <time dateTime={departureAt} className="font-semibold">
            {formatTime(departureAt, locale)}
          </time>
        </p>
        <ul className="flex flex-col gap-1">
          {booking.passengers.map((passenger) => (
            <li key={passenger.id}>
              {t('passenger', { label: passenger.seatLabel, name: passenger.fullName })}
            </li>
          ))}
        </ul>
        <p className="font-semibold">{t('total', { price: total })}</p>
      </section>

      {step === 'pay' && !expired ? (
        <section aria-labelledby="checkout-method" className="flex flex-col gap-3">
          <h2 id="checkout-method" className="text-lg font-semibold">
            {t('methodHeading')}
          </h2>
          <form
            action={formAction}
            onSubmit={submit}
            className="flex flex-col gap-3 rounded-lg border-2 border-brand-600 p-4"
          >
            <input type="hidden" name="bookingId" value={booking.id} />
            <input type="hidden" name="token" value={token} />
            <p className="font-semibold">{t('cashTitle')}</p>
            <p className="text-slate-700">{t('cashText', { total, company })}</p>
            <button
              type="submit"
              disabled={pending || reserved}
              className="rounded-lg bg-brand-600 px-4 py-3 font-semibold text-white hover:bg-brand-700 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              {pending || reserved ? t('cashSubmitting') : t('cashSubmit')}
            </button>
          </form>
          {reserve.status === 'error' && reserve.code !== 'HOLD_EXPIRED' ? (
            reserve.code === 'CASH_DEADLINE_PASSED' ? (
              <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-900">
                {t('cashDeadlinePassed')}
              </p>
            ) : (
              <ProblemNotice code={reserve.code} />
            )
          ) : null}
          {reserved ? (
            <p role="status" className="text-sm text-slate-700">
              {t('reserved')}{' '}
              <a href={href} className="font-semibold underline">
                {t('openTicket')}
              </a>
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
