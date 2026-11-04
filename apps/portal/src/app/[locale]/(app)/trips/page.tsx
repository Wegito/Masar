import type { Locale } from '@masar/shared';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { getPortalSession } from '../../../../lib/session';
import { canManageTrips } from '../../../../lib/trips';
import { TripsManager } from './trips-manager';

/**
 * Fahrten der gewählten Firma (Schritt 2.4): kommende Fahrten mit Kontingent, Woche planen mit
 * Vorschau der Termine über die API, veröffentlichen, absagen. Lesen dürfen alle Rollen, planen
 * und absagen nur Admins; die API prüft beides selbst.
 */
export default async function TripsPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<ReactNode> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'trips' });
  const session = await getPortalSession();
  const company = session?.company ?? null;

  return (
    <>
      <section className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-slate-600">{t('intro')}</p>
      </section>
      {company === null ? (
        <p className="rounded-lg bg-amber-50 p-3 text-amber-900">{t('noCompany')}</p>
      ) : (
        // Neuer Schlüssel je Firma: Ein Firmenwechsel lädt Listen und Formular neu.
        <TripsManager
          key={company.companyId}
          companyId={company.companyId}
          canWrite={canManageTrips(company.role)}
        />
      )}
    </>
  );
}
