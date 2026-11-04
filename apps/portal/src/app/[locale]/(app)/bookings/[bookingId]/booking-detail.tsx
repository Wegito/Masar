'use client';

import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useState } from 'react';

import { ProblemMessage } from '../../../../../components/problem-message';
import { Link } from '../../../../../i18n/navigation';
import { api, type Problem } from '../../../../../lib/api';
import type { StaffBooking } from '../../../../../lib/booking';
import { BookingPanel } from '../booking-panel';

type Failure = { problem: Problem; retryAfterSeconds?: number };

/** Lädt die Buchung über die API und zeigt sie mit Verlauf und Aktionen. */
export function BookingDetail({
  companyId,
  bookingId,
}: {
  companyId: string;
  bookingId: string;
}): ReactNode {
  const t = useTranslations('bookings');
  const [booking, setBooking] = useState<StaffBooking>();
  const [failure, setFailure] = useState<Failure>();

  useEffect(() => {
    let active = true;
    void api<StaffBooking>(`/companies/${companyId}/bookings/${bookingId}`).then((result) => {
      if (!active) return;
      if (result.ok) {
        setBooking(result.data);
      } else {
        setFailure(result);
      }
    });
    return () => {
      active = false;
    };
  }, [companyId, bookingId]);

  if (failure !== undefined) {
    return <ProblemMessage {...failure} />;
  }
  if (booking === undefined) {
    return <p className="text-slate-600">{t('detail.loading')}</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      <BookingPanel companyId={companyId} initial={booking} detailed />
      <p>
        <Link
          href={`/trips/${booking.trip.id}/passengers`}
          className="font-medium text-brand-700 hover:underline"
        >
          {t('detail.tripPassengers')}
        </Link>
      </p>
    </div>
  );
}
