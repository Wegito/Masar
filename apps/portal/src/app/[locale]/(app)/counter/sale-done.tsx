'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Link } from '../../../../i18n/navigation';
import type { StaffBooking } from '../../../../lib/booking';
import { BookingPanel } from '../bookings/booking-panel';

/**
 * Nach dem Verkauf: Hinweis, Link zur Druckansicht, die Buchung mit der vorhandenen Storno-Aktion
 * (`BookingPanel`) und „nächster Verkauf". Nur Anzeige.
 */
export function SaleDone({
  companyId,
  booking,
  onNext,
}: {
  companyId: string;
  booking: StaffBooking;
  onNext: () => void;
}): ReactNode {
  const t = useTranslations('counter.done');
  return (
    <section aria-labelledby="counter-done" className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <h2 id="counter-done" className="text-lg font-semibold text-emerald-900">
          {t('heading')}
        </h2>
        <p role="status" className="text-sm text-emerald-900">
          {t('notice')}
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href={`/counter/tickets/${booking.id}`}
            className="rounded-lg bg-brand-600 px-4 py-2.5 font-semibold text-white hover:bg-brand-700"
          >
            {t('print')}
          </Link>
          <button
            type="button"
            onClick={onNext}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 font-medium text-slate-700 hover:bg-slate-100"
          >
            {t('next')}
          </button>
        </div>
      </div>
      <BookingPanel key={booking.id} companyId={companyId} initial={booking} />
    </section>
  );
}
