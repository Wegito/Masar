import type { Locale } from '@masar/shared';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { Link } from '../../../../../../i18n/navigation';
import { isUuid } from '../../../../../../lib/booking';
import { canManageBookings } from '../../../../../../lib/company';
import { getPortalSession } from '../../../../../../lib/session';
import { PassengerList } from './passenger-list';

/**
 * Fahrgastliste einer Fahrt (Schritt 2.5, ADR 0028) für Schalter und Fahrer: nach Sitz, mit
 * Zustieg, Ausstieg und Zahlungsstand. Ohne Kontaktdaten und Buchungscodes; Admin und Agent
 * kommen von hier zur Buchung.
 */
export default async function TripPassengersPage({
  params,
}: {
  params: Promise<{ locale: Locale; tripId: string }>;
}): Promise<ReactNode> {
  const { locale, tripId } = await params;
  if (!isUuid(tripId)) {
    notFound();
  }
  const t = await getTranslations({ locale, namespace: 'passengers' });
  const session = await getPortalSession();
  const company = session?.company ?? null;

  return (
    <>
      <section className="flex flex-col gap-1">
        <Link href="/trips" className="text-sm text-brand-700 hover:underline">
          {t('back')}
        </Link>
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-slate-600">{t('intro')}</p>
      </section>
      {company === null ? (
        <p className="rounded-lg bg-amber-50 p-3 text-amber-900">{t('noCompany')}</p>
      ) : (
        <PassengerList
          key={company.companyId}
          companyId={company.companyId}
          tripId={tripId}
          canOpenBookings={canManageBookings(company.role)}
        />
      )}
    </>
  );
}
