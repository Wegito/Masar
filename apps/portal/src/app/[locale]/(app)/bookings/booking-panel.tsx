'use client';

import {
  COMPANY_CANCEL_REASONS,
  type CompanyCancelReason,
  formatBookingCode,
  formatDateTime,
  type Locale,
} from '@masar/shared';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';

import { ProblemMessage } from '../../../../components/problem-message';
import { Link } from '../../../../i18n/navigation';
import { api, type Problem } from '../../../../lib/api';
import {
  BOOKING_STATUS_BADGE,
  bookingActions,
  type BookingContact,
  formatTotal,
  historyActionKey,
  PAYMENT_STATE_BADGE,
  type StaffBooking,
} from '../../../../lib/booking';
import { localName } from '../../../../lib/routes';

type Failure = { problem: Problem; retryAfterSeconds?: number };
type Notice = 'confirmed' | 'cancelled';

/**
 * Eine Buchung mit Aktionen am Schalter (Schritt 2.5): Fahrt, Zahlungsstand, Kontakt (Telefon
 * maskiert, Klartext erst auf Klick über `reveal-contact`, den die API im Audit-Log vermerkt),
 * Fahrgäste, „Barzahlung bestätigen" und Storno in zwei Schritten. Mit `detailed` zusätzlich
 * Geschlecht, Ausweis (nur „vorhanden"), Tickets und Verlauf. Kontaktdaten bleiben im Speicher
 * dieser Komponente und verschwinden mit ihr.
 */
export function BookingPanel({
  companyId,
  initial,
  detailed = false,
}: {
  companyId: string;
  initial: StaffBooking;
  detailed?: boolean;
}): ReactNode {
  const t = useTranslations('bookings');
  const locale = useLocale() as Locale;
  const [booking, setBooking] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>();
  const [notice, setNotice] = useState<Notice>();
  const [cancelling, setCancelling] = useState(false);
  const [contact, setContact] = useState<BookingContact>();
  const base = `/companies/${companyId}/bookings/${booking.id}`;
  const actions = bookingActions(booking.status);
  const total = formatTotal(booking.total, locale);
  const code = (
    <bdi dir="ltr" translate="no" className="font-mono">
      {formatBookingCode(booking.bookingCode)}
    </bdi>
  );

  async function act(path: 'confirm-cash' | 'cancel', body: unknown, success: Notice) {
    setBusy(true);
    setNotice(undefined);
    const result = await api<StaffBooking>(`${base}/${path}`, {
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

  async function reveal(): Promise<void> {
    setBusy(true);
    const result = await api<BookingContact>(`${base}/reveal-contact`, { method: 'POST' });
    setBusy(false);
    if (result.ok) {
      setFailure(undefined);
      setContact(result.data);
    } else {
      setFailure(result);
    }
  }

  return (
    <article
      aria-labelledby={`booking-${booking.id}`}
      data-booking-id={booking.id}
      className="flex flex-col gap-4 rounded-md border border-brand-100 bg-white p-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={`booking-${booking.id}`} className="text-lg font-semibold">
          {t('result')} {code}
        </h2>
        <div className="flex flex-wrap gap-2">
          <span
            className={`rounded-full px-3 py-1 text-sm font-medium ${BOOKING_STATUS_BADGE[booking.status]}`}
          >
            <span className="sr-only">{t('statusLabel')}: </span>
            <span>{t(`status.${booking.status}`)}</span>
          </span>
          <span
            className={`rounded-full px-3 py-1 text-sm font-medium ${PAYMENT_STATE_BADGE[booking.paymentState]}`}
          >
            <span className="sr-only">{t('paymentStateLabel')}: </span>
            <span>{t(`paymentStates.${booking.paymentState}`)}</span>
          </span>
        </div>
      </header>
      {failure ? <ProblemMessage {...failure} /> : null}
      {notice ? (
        <p role="status" className="rounded-md bg-green-50 p-3 text-sm text-green-800">
          {t(notice)}
        </p>
      ) : null}
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <Item label={t('trip')}>
          {localName(booking.trip.route, locale)}
          <span className="block text-sm font-normal text-slate-600">
            {t('route', {
              from: localName(booking.from, locale),
              to: localName(booking.to, locale),
            })}
          </span>
        </Item>
        <Item label={t('departure')}>
          <span className="tabular-nums">
            {formatDateTime(booking.from.departureAt ?? booking.trip.departureAt, locale)}
          </span>
        </Item>
        <Item label={t('total')}>{total}</Item>
        <Item label={t('paymentMethod')}>
          {t(`paymentMethods.${booking.paymentMethod ?? 'none'}`)}
        </Item>
        {booking.status === 'RESERVED' && booking.deadlineAt !== null ? (
          <Item label={t('payBy')}>
            <span className="tabular-nums">{formatDateTime(booking.deadlineAt, locale)}</span>
          </Item>
        ) : null}
        {booking.status === 'HELD' && booking.holdExpiresAt !== null ? (
          <Item label={t('heldUntil')}>
            <span className="tabular-nums">{formatDateTime(booking.holdExpiresAt, locale)}</span>
          </Item>
        ) : null}
        <Item label={t('contact')}>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{booking.contact.name}</span>
            <bdi
              dir="ltr"
              translate="no"
              className="whitespace-nowrap tabular-nums"
              data-testid="contact-phone"
            >
              {contact?.phone ?? booking.contact.phoneMasked}
            </bdi>
            {contact?.email ? (
              <bdi dir="ltr" translate="no" className="text-sm font-normal">
                {contact.email}
              </bdi>
            ) : null}
            {contact === undefined && !booking.contact.purged ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void reveal()}
                className="rounded-md border border-slate-300 px-2 py-0.5 text-sm font-normal text-slate-700 hover:bg-slate-100 disabled:opacity-60"
              >
                {t('revealContact')}
              </button>
            ) : null}
          </span>
        </Item>
        {detailed ? <Item label={t('channel')}>{t(`channels.${booking.channel}`)}</Item> : null}
      </dl>
      {contact === undefined ? null : <p className="text-xs text-slate-500">{t('revealNotice')}</p>}
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-slate-600">{t('passengers')}</h3>
        <ul className="flex flex-col gap-1">
          {booking.passengers.map((passenger) => (
            <li key={passenger.id} className="flex flex-wrap gap-x-3 gap-y-1">
              <span className="w-24 shrink-0 text-slate-600">
                {t('seat', { label: passenger.seatLabel })}
              </span>
              <span>{passenger.fullName}</span>
              {detailed ? (
                <span className="text-sm text-slate-600">
                  {passenger.gender === null ? null : t(`genders.${passenger.gender}`)}
                  {passenger.gender === null ? null : ' · '}
                  {passenger.nationalIdPresent ? t('nationalIdPresent') : t('nationalIdMissing')}
                  {passenger.ticketStatus === null
                    ? null
                    : ` · ${t(`ticketStatus.${passenger.ticketStatus}`)}`}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
      {detailed ? <History booking={booking} /> : null}
      {actions.confirmCash || actions.cancel || !detailed ? (
        <footer className="flex flex-col gap-3 border-t border-brand-100 pt-4">
          {actions.confirmCash ? (
            <p className="text-sm text-slate-600">{t('confirmCashHint', { amount: total })}</p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            {actions.confirmCash ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void act('confirm-cash', undefined, 'confirmed')}
                className="rounded-md bg-brand-600 px-4 py-2.5 font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {busy ? t('working') : t('confirmCash')}
              </button>
            ) : null}
            {actions.cancel && !cancelling ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => setCancelling(true)}
                className="rounded-md border border-red-300 px-4 py-2.5 font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
              >
                {t('cancel')}
              </button>
            ) : null}
            {detailed ? null : (
              <Link
                href={`/bookings/${booking.id}`}
                className="rounded-md border border-slate-300 px-4 py-2.5 font-medium text-slate-700 hover:bg-slate-100"
              >
                {t('openDetail')}
              </Link>
            )}
          </div>
          {actions.cancel && cancelling ? (
            <CancelForm
              busy={busy}
              onAbort={() => setCancelling(false)}
              onSubmit={(reason) => {
                setCancelling(false);
                void act('cancel', { reason }, 'cancelled');
              }}
            />
          ) : null}
        </footer>
      ) : null}
    </article>
  );
}

function History({ booking }: { booking: StaffBooking }): ReactNode {
  const t = useTranslations('bookings');
  const locale = useLocale() as Locale;
  return (
    <section className="flex flex-col gap-2" aria-labelledby={`history-${booking.id}`}>
      <h3 id={`history-${booking.id}`} className="text-sm font-medium text-slate-600">
        {t('history.title')}
      </h3>
      {booking.history.length === 0 ? (
        <p className="text-sm text-slate-600">{t('history.empty')}</p>
      ) : (
        <ol className="flex flex-col gap-1 text-sm">
          {booking.history.map((entry, index) => (
            <li key={`${entry.at}-${String(index)}`} className="flex flex-wrap gap-x-3">
              <span className="min-w-36 tabular-nums text-slate-600">
                {formatDateTime(entry.at, locale)}
              </span>
              <span>{t(`history.actions.${historyActionKey(entry.action)}`)}</span>
              <span className="text-slate-500">{t(`history.actors.${entry.actorType}`)}</span>
              {entry.reason === null ? null : (
                <span className="text-slate-500">
                  {t.has(`cancelReasons.${entry.reason}`)
                    ? t(`cancelReasons.${entry.reason}`)
                    : t('history.otherReason')}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
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
    <div className="flex flex-col gap-3 rounded-md bg-red-50 p-3">
      <p className="text-sm text-red-900">{t('cancelWarning')}</p>
      <label className="flex flex-col gap-1.5 sm:w-72">
        <span className="text-sm font-medium">{t('cancelReason')}</span>
        <select
          value={reason}
          onChange={(event) => setReason(event.currentTarget.value as CompanyCancelReason)}
          className="rounded-md border border-slate-300 bg-white px-3 py-2"
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
          className="rounded-md bg-red-700 px-4 py-2.5 font-semibold text-white hover:bg-red-800 disabled:opacity-60"
        >
          {t('cancelConfirm')}
        </button>
        <button
          type="button"
          onClick={onAbort}
          className="rounded-md border border-slate-300 px-4 py-2.5 hover:bg-slate-100"
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
