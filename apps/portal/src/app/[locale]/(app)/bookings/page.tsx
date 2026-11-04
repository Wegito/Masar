import type { Locale } from '@masar/shared';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { isUuid } from '../../../../lib/booking';
import { canManageBookings } from '../../../../lib/company';
import { getPortalSession } from '../../../../lib/session';
import { BookingDesk } from './booking-desk';
import { BookingList } from './booking-list';

/**
 * Buchungen der gewählten Firma (Schritt 2.5, ADR 0028): oben die Suche über den vollständigen
 * Buchungscode mit Barzahlung und Storno, darunter die Liste mit Filtern. `?tripId=` (aus der
 * Fahrgastliste) filtert auf eine Fahrt; die ID trägt keine Personendaten. Suchtext und Code
 * stehen nie in der Adresse der Seite.
 */
export default async function BookingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const { locale } = await params;
  const { tripId } = await searchParams;
  const t = await getTranslations({ locale, namespace: 'bookings' });
  const session = await getPortalSession();
  const company = session?.company ?? null;
  const trip = isUuid(tripId) ? tripId : undefined;

  return (
    <>
      <section className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-slate-600">{t('intro')}</p>
      </section>
      {company === null ? (
        <p className="rounded-md bg-amber-50 p-3 text-amber-900">{t('noCompany')}</p>
      ) : canManageBookings(company.role) ? (
        // Neuer Schlüssel je Firma: Ein Firmenwechsel leert Suche, Filter und Ergebnis.
        <div key={company.companyId} className="flex flex-col gap-8">
          <BookingDesk companyId={company.companyId} />
          <BookingList key={trip ?? 'all'} companyId={company.companyId} tripId={trip} />
        </div>
      ) : (
        <p className="rounded-md bg-amber-50 p-3 text-amber-900">{t('noAccess')}</p>
      )}
    </>
  );
}
