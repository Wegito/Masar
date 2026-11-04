import type { Locale } from '@masar/shared';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { canManageBookings } from '../../../../lib/company';
import { getPortalSession } from '../../../../lib/session';
import { CounterDesk } from './counter-desk';

/**
 * Schalter der gewählten Firma (Schritt 2.6, ADR 0030): Fahrt wählen, Teilstrecke, Sitze im
 * selben Inventar wie online, Fahrgastdaten, Preis, bar verkaufen, Ticket drucken. Verkaufen
 * dürfen Admin und Agent; die API prüft das selbst noch einmal.
 */
export default async function CounterPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<ReactNode> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'counter' });
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
      ) : canManageBookings(company.role) ? (
        // Neuer Schlüssel je Firma: Ein Firmenwechsel leert Auswahl und Formular.
        <CounterDesk key={company.companyId} companyId={company.companyId} />
      ) : (
        <p className="rounded-lg bg-amber-50 p-3 text-amber-900">{t('noAccess')}</p>
      )}
    </>
  );
}
