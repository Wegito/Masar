import type { Locale } from '@masar/shared';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { Link } from '../../../../../i18n/navigation';
import { isUuid } from '../../../../../lib/booking';
import { canManageBookings } from '../../../../../lib/company';
import { getPortalSession } from '../../../../../lib/session';
import { BookingDetail } from './booking-detail';

/**
 * Detail einer Buchung (Schritt 2.5, ADR 0028): Fahrgäste mit Sitz und Geschlecht, Ausweis nur
 * „vorhanden", Zahlungsstand, Frist, Verlauf und die Aktionen am Schalter. Die Daten lädt der
 * Browser über die API; die Seite selbst prüft nur Sitzung und Rolle.
 */
export default async function BookingDetailPage({
  params,
}: {
  params: Promise<{ locale: Locale; bookingId: string }>;
}): Promise<ReactNode> {
  const { locale, bookingId } = await params;
  if (!isUuid(bookingId)) {
    notFound();
  }
  const t = await getTranslations({ locale, namespace: 'bookings' });
  const session = await getPortalSession();
  const company = session?.company ?? null;

  return (
    <>
      <section className="flex flex-col gap-1">
        <Link href="/bookings" className="text-sm text-brand-700 hover:underline">
          {t('detail.back')}
        </Link>
        <h1 className="text-2xl font-bold">{t('detail.title')}</h1>
      </section>
      {company === null ? (
        <p className="rounded-lg bg-amber-50 p-3 text-amber-900">{t('noCompany')}</p>
      ) : canManageBookings(company.role) ? (
        <BookingDetail
          key={company.companyId}
          companyId={company.companyId}
          bookingId={bookingId}
        />
      ) : (
        <p className="rounded-lg bg-amber-50 p-3 text-amber-900">{t('noAccess')}</p>
      )}
    </>
  );
}
