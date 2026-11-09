'use client';

import type { Locale } from '@masar/shared';
import { useLocale, useTranslations } from 'next-intl';
import { type FormEvent, type ReactNode, startTransition, useActionState, useEffect } from 'react';

import { lookupBooking, type LookupState } from '../app/[locale]/my-booking/actions';
import { ticketHref } from '../lib/ticket';
import { ProblemNotice } from './problem-notice';

const FIELD =
  'rounded-lg border border-slate-300 bg-white px-3 py-2 text-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600';

const initial: LookupState = { status: 'idle' };

/**
 * Formular „Meine Buchung". Code und Telefon gehen per Server Action im POST-Body an den
 * Web-Server und von dort im Body an die API; keine URL enthält sie. Bei Erfolg öffnet die Seite
 * das Ticket mit dem Lesetoken im Fragment (`#token=`). Mit JavaScript löst die Seite die Action
 * selbst aus, damit React das Formular danach nicht leert: Ein Tippfehler ist so schnell korrigiert.
 */
export function BookingLookupForm(): ReactNode {
  const t = useTranslations('lookup');
  const locale = useLocale() as Locale;
  const [state, formAction, pending] = useActionState(lookupBooking, initial);
  const href = state.status === 'found' ? ticketHref(locale, state.bookingId, state.token) : null;

  useEffect(() => {
    if (href !== null) {
      // Volle Navigation: Die Ticketseite liest das Token aus dem Fragment.
      window.location.assign(href);
    }
  }, [href]);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  }

  return (
    <form action={formAction} onSubmit={submit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="font-medium">{t('code')}</span>
        <input
          name="bookingCode"
          required
          maxLength={20}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          dir="ltr"
          aria-describedby="lookup-code-hint"
          className={`${FIELD} font-mono uppercase tracking-wider`}
        />
        <span id="lookup-code-hint" className="text-sm text-slate-600">
          {t('codeHint')}
        </span>
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-medium">{t('phone')}</span>
        <input
          name="phone"
          type="tel"
          required
          maxLength={40}
          inputMode="tel"
          autoComplete="tel"
          dir="ltr"
          aria-describedby="lookup-phone-hint"
          className={`${FIELD} text-start`}
        />
        <span id="lookup-phone-hint" className="text-sm text-slate-600">
          {t('phoneHint')}
        </span>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-lg bg-brand-600 px-5 py-2.5 font-semibold text-white hover:bg-brand-700 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        {pending ? t('searching') : t('submit')}
      </button>
      {state.status === 'error' ? (
        state.code === 'BOOKING_NOT_FOUND' || state.code === 'VALIDATION_FAILED' ? (
          <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-900">
            {t(state.code === 'BOOKING_NOT_FOUND' ? 'notFound' : 'invalid')}
          </p>
        ) : (
          <ProblemNotice code={state.code} />
        )
      ) : null}
      {href === null ? null : (
        <p role="status" className="rounded-lg bg-emerald-50 p-4 text-emerald-900">
          {t('found')}{' '}
          <a href={href} className="font-semibold underline">
            {t('openTicket')}
          </a>
        </p>
      )}
    </form>
  );
}
