import type { Locale } from '@masar/shared';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { Link } from '../../../../../../i18n/navigation';
import { isUuid } from '../../../../../../lib/booking';
import { canManageBookings } from '../../../../../../lib/company';
import { getPortalSession } from '../../../../../../lib/session';
import { TicketPrint } from './ticket-print';

/**
 * Druckansicht der Tickets einer Buchung (Schritt 2.6, ADR 0030): je Fahrgast QR-Code, Code, Sitz,
 * Strecke und Zeiten in Damaskus. Kopfzeile und Navigation erscheinen nicht im Druck.
 */
export default async function CounterTicketPage({
  params,
}: {
  params: Promise<{ locale: Locale; bookingId: string }>;
}): Promise<ReactNode> {
  const { locale, bookingId } = await params;
  if (!isUuid(bookingId)) {
    notFound();
  }
  const t = await getTranslations({ locale, namespace: 'counter' });
  const session = await getPortalSession();
  const company = session?.company ?? null;

  return (
    <>
      <section className="flex flex-col gap-1 print:hidden">
        <Link href="/counter" className="text-sm text-brand-700 hover:underline">
          {t('ticket.back')}
        </Link>
        <h1 className="text-2xl font-bold">{t('ticket.title')}</h1>
      </section>
      {company === null ? (
        <p className="rounded-lg bg-amber-50 p-3 text-amber-900">{t('noCompany')}</p>
      ) : canManageBookings(company.role) ? (
        <TicketPrint key={company.companyId} companyId={company.companyId} bookingId={bookingId} />
      ) : (
        <p className="rounded-lg bg-amber-50 p-3 text-amber-900">{t('noAccess')}</p>
      )}
    </>
  );
}
