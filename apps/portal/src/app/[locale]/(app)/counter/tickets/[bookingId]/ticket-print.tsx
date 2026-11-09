'use client';

import { formatBookingCode, formatDate, formatTime, type Locale } from '@masar/shared';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useState } from 'react';

import { ProblemMessage } from '../../../../../../components/problem-message';
import { api, type Problem } from '../../../../../../lib/api';
import { formatTotal } from '../../../../../../lib/booking';
import type { PrintTicket } from '../../../../../../lib/counter';
import { qrGeometry } from '../../../../../../lib/qr';
import { localName } from '../../../../../../lib/routes';

type Failure = { problem: Problem; retryAfterSeconds?: number };

/** QR-Code als SVG-Pfad, ohne Inline-Styles (CSP). */
function QrCode({ token, label }: { token: string; label: string }): ReactNode {
  const { size, path } = qrGeometry(token);
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${String(size)} ${String(size)}`}
      shapeRendering="crispEdges"
      className="size-40 shrink-0 bg-white"
    >
      <path d={path} className="fill-black" />
    </svg>
  );
}

/**
 * Lädt das Ticket über `GET …/bookings/:id/ticket` und zeigt je Fahrgast eine druckbare Karte.
 * Das QR-Token bleibt im Speicher dieser Seite; es steht nie in der Adresse.
 */
export function TicketPrint({
  companyId,
  bookingId,
}: {
  companyId: string;
  bookingId: string;
}): ReactNode {
  const t = useTranslations('counter.ticket');
  const tCounter = useTranslations('counter');
  const locale = useLocale() as Locale;
  const [ticket, setTicket] = useState<PrintTicket>();
  const [failure, setFailure] = useState<Failure>();

  useEffect(() => {
    let active = true;
    void api<PrintTicket>(`/companies/${companyId}/bookings/${bookingId}/ticket`).then((result) => {
      if (!active) return;
      if (result.ok) setTicket(result.data);
      else setFailure(result);
    });
    return () => {
      active = false;
    };
  }, [companyId, bookingId]);

  if (failure !== undefined) return <ProblemMessage {...failure} />;
  if (ticket === undefined) return <p className="text-slate-600">{tCounter('loading')}</p>;

  const passengerById = new Map(ticket.passengers.map((p) => [p.id, p]));
  const code = formatBookingCode(ticket.bookingCode);
  const departure = ticket.from.departureAt ?? ticket.trip.departureAt;

  return (
    <div className="flex flex-col gap-4">
      <div className="print:hidden">
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-lg bg-brand-600 px-4 py-2.5 font-semibold text-white hover:bg-brand-700"
        >
          {t('print')}
        </button>
      </div>
      <ul className="flex flex-col gap-4">
        {ticket.tickets.map((entry) => {
          const passenger = passengerById.get(entry.passengerId);
          return (
            <li
              key={entry.id}
              data-ticket-seat={entry.seatLabel}
              className="flex flex-col gap-4 rounded-xl border border-slate-300 bg-white p-4 break-inside-avoid sm:flex-row"
            >
              {entry.qrToken === null ? (
                <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 sm:w-40">
                  {t('noQr')}
                </p>
              ) : (
                <QrCode token={entry.qrToken} label={t('qrLabel', { label: entry.seatLabel })} />
              )}
              <dl className="grid flex-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-slate-500">{localName(ticket.trip.company, locale)}</dt>
                  <dd className="text-lg font-bold">
                    <span className="sr-only">{t('code')}: </span>
                    <bdi dir="ltr" translate="no" className="font-mono">
                      {code}
                    </bdi>
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">{t('seat')}</dt>
                  <dd className="text-lg font-bold tabular-nums">{entry.seatLabel}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">{t('passenger')}</dt>
                  <dd className="font-medium">{passenger?.fullName}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">{t('route')}</dt>
                  <dd className="font-medium">
                    {localName(ticket.from, locale)} → {localName(ticket.to, locale)}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">{t('departure')}</dt>
                  <dd className="tabular-nums" data-testid="ticket-departure">
                    {formatDate(departure, locale, 'full')} · {formatTime(departure, locale)}
                  </dd>
                </div>
                {ticket.to.arrivalAt === null ? null : (
                  <div>
                    <dt className="text-slate-500">{t('arrival')}</dt>
                    <dd className="tabular-nums">{formatTime(ticket.to.arrivalAt, locale)}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-slate-500">{t('total')}</dt>
                  <dd className="tabular-nums">{formatTotal(ticket.total, locale)}</dd>
                </div>
                <p className="text-xs text-slate-500 sm:col-span-2">{t('timeZone')}</p>
              </dl>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
