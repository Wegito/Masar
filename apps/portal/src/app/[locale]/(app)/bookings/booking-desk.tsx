'use client';

import {
  COMPANY_CANCEL_REASONS,
  type CompanyCancelReason,
  formatBookingCode,
  formatDateTime,
  type Locale,
  normalizeBookingCode,
} from '@masar/shared';
import { useLocale, useTranslations } from 'next-intl';
import { type FormEvent, type ReactNode, useState } from 'react';

import { Field, SubmitButton } from '../../../../components/field';
import { ProblemMessage } from '../../../../components/problem-message';
import { api, formText, type Problem } from '../../../../lib/api';
import { bookingActions, formatTotal, type StaffBooking } from '../../../../lib/booking';

type Failure = { problem: Problem; retryAfterSeconds?: number };
type Notice = 'confirmed' | 'cancelled';

/**
 * Suche nach Buchungscode und Aktionen am Schalter. Der Code geht nur im POST-Body an die API, nie
 * in die URL (ADR 0016). Die Firma steht im Pfad der API; dass die Person dort Admin oder Agent
 * ist, prüft die API selbst. Personendaten der Buchung bleiben im Speicher der Seite.
 */
export function BookingDesk({ companyId }: { companyId: string }): ReactNode {
  const t = useTranslations('bookings');
  const [busy, setBusy] = useState(false);
  const [booking, setBooking] = useState<StaffBooking>();
  const [failure, setFailure] = useState<Failure>();
  const [notice, setNotice] = useState<Notice>();
  const base = `/companies/${companyId}/bookings`;

  async function search(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const raw = formText(new FormData(event.currentTarget), 'bookingCode');
    setNotice(undefined);
    setBooking(undefined);
    // Offensichtlich falsche Eingaben gar nicht erst senden; dieselbe Meldung wie die API.
    if (normalizeBookingCode(raw) === null) {
      setFailure({
        problem: {
          code: 'VALIDATION_FAILED',
          status: 400,
          errors: [{ path: 'bookingCode', rule: 'custom' }],
        },
      });
      return;
    }
    setBusy(true);
    const result = await api<StaffBooking>(`${base}/lookup`, {
      method: 'POST',
      body: { bookingCode: raw },
    });
    setBusy(false);
    if (result.ok) {
      setFailure(undefined);
      setBooking(result.data);
    } else {
      setFailure(result);
    }
  }

  async function act(
    path: 'confirm-cash' | 'cancel',
    body: unknown,
    success: Notice,
  ): Promise<void> {
    if (booking === undefined) {
      return;
    }
    setBusy(true);
    setNotice(undefined);
    const result = await api<StaffBooking>(`${base}/${booking.id}/${path}`, {
      method: 'POST',
      ...(body === undefined ? {} : { body }),
    });
    setBusy(false);
    if (result.ok) {
      setFailure(undefined);
      setBooking(result.data);
      setNotice(success);
    } else {
      setFailure(result);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form
        onSubmit={(event) => void search(event)}
        className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-end"
      >
        <div className="sm:w-72">
          <Field
            label={t('code')}
            hint={t('codeHint')}
            name="bookingCode"
            dir="ltr"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={20}
            required
          />
        </div>
        <SubmitButton busy={busy}>{busy ? t('searching') : t('search')}</SubmitButton>
      </form>
      {failure ? <ProblemMessage {...failure} /> : null}
      {notice ? (
        <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">
          {t(notice)}
        </p>
      ) : null}
      {booking ? (
        <BookingCard
          booking={booking}
          busy={busy}
          onConfirmCash={() => void act('confirm-cash', undefined, 'confirmed')}
          onCancel={(reason) => void act('cancel', { reason }, 'cancelled')}
        />
      ) : null}
    </div>
  );
}

function BookingCard({
  booking,
  busy,
  onConfirmCash,
  onCancel,
}: {
  booking: StaffBooking;
  busy: boolean;
  onConfirmCash: () => void;
  onCancel: (reason: CompanyCancelReason) => void;
}): ReactNode {
  const t = useTranslations('bookings');
  const locale = useLocale() as Locale;
  const [cancelling, setCancelling] = useState(false);
  const actions = bookingActions(booking.status);
  const station = (stop: { nameAr: string; nameEn: string }): string =>
    locale === 'ar' ? stop.nameAr : stop.nameEn;
  const total = formatTotal(booking.total, locale);
  const code = (
    <bdi dir="ltr" translate="no" className="font-mono">
      {formatBookingCode(booking.bookingCode)}
    </bdi>
  );

  return (
    <article
      aria-labelledby="booking-heading"
      className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="booking-heading" className="text-lg font-semibold">
          {t('result')} {code}
        </h2>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium">
          <span className="sr-only">{t('statusLabel')}: </span>
          <span>{t(`status.${booking.status}`)}</span>
        </span>
      </header>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <Item label={t('trip')}>
          {t('route', { from: station(booking.from), to: station(booking.to) })}
        </Item>
        <Item label={t('departure')}>
          {formatDateTime(booking.from.departureAt ?? booking.trip.departureAt, locale)}
        </Item>
        <Item label={t('total')}>{total}</Item>
        <Item label={t('paymentMethod')}>
          {t(`paymentMethods.${booking.paymentMethod ?? 'none'}`)}
        </Item>
        {booking.status === 'RESERVED' && booking.deadlineAt !== null ? (
          <Item label={t('payBy')}>{formatDateTime(booking.deadlineAt, locale)}</Item>
        ) : null}
        <Item label={t('contact')}>
          {booking.contact.name} ·{' '}
          <bdi dir="ltr" translate="no">
            {booking.contact.phone}
          </bdi>
        </Item>
      </dl>
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-slate-600">{t('passengers')}</h3>
        <ul className="flex flex-col gap-1">
          {booking.passengers.map((passenger) => (
            <li key={passenger.id} className="flex gap-3">
              <span className="w-24 shrink-0 text-slate-600">
                {t('seat', { label: passenger.seatLabel })}
              </span>
              <span>{passenger.fullName}</span>
            </li>
          ))}
        </ul>
      </section>
      {actions.confirmCash || actions.cancel ? (
        <footer className="flex flex-col gap-3 border-t border-slate-200 pt-4">
          {actions.confirmCash ? (
            <p className="text-sm text-slate-600">{t('confirmCashHint', { amount: total })}</p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            {actions.confirmCash ? (
              <button
                type="button"
                disabled={busy}
                onClick={onConfirmCash}
                className="rounded-lg bg-brand-600 px-4 py-2.5 font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {busy ? t('working') : t('confirmCash')}
              </button>
            ) : null}
            {actions.cancel && !cancelling ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => setCancelling(true)}
                className="rounded-lg border border-red-300 px-4 py-2.5 font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
              >
                {t('cancel')}
              </button>
            ) : null}
          </div>
          {actions.cancel && cancelling ? (
            <CancelForm
              busy={busy}
              onAbort={() => setCancelling(false)}
              onSubmit={(reason) => {
                setCancelling(false);
                onCancel(reason);
              }}
            />
          ) : null}
        </footer>
      ) : null}
    </article>
  );
}

/** Zweiter Schritt des Stornos: Grund wählen und bestätigen. Nur Codes, kein Freitext (ADR 0016). */
function CancelForm({
  busy,
  onAbort,
  onSubmit,
}: {
  busy: boolean;
  onAbort: () => void;
  onSubmit: (reason: CompanyCancelReason) => void;
}): ReactNode {
  const t = useTranslations('bookings');
  const [reason, setReason] = useState<CompanyCancelReason>('PASSENGER_REQUEST');
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-red-50 p-3">
      <p className="text-sm text-red-900">{t('cancelWarning')}</p>
      <label className="flex flex-col gap-1.5 sm:w-72">
        <span className="text-sm font-medium">{t('cancelReason')}</span>
        <select
          value={reason}
          onChange={(event) => setReason(event.currentTarget.value as CompanyCancelReason)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2"
        >
          {COMPANY_CANCEL_REASONS.map((value) => (
            <option key={value} value={value}>
              {t(`cancelReasons.${value}`)}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => onSubmit(reason)}
          className="rounded-lg bg-red-700 px-4 py-2.5 font-semibold text-white hover:bg-red-800 disabled:opacity-60"
        >
          {t('cancelConfirm')}
        </button>
        <button
          type="button"
          onClick={onAbort}
          className="rounded-lg border border-slate-300 px-4 py-2.5 hover:bg-slate-100"
        >
          {t('cancelAbort')}
        </button>
      </div>
    </div>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-sm text-slate-600">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}
