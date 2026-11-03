import type { Locale } from '@masar/shared';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { canManageFleet } from '../../../../lib/fleet';
import { getPortalSession } from '../../../../lib/session';
import { FleetManager } from './fleet-manager';

/**
 * Flotte der gewählten Firma (Schritt 2.2): Sitzpläne aus dem Generator mit Vorschau und Busse.
 * Lesen dürfen alle Rollen, Anlegen und Ändern nur Admins; die API prüft beides selbst.
 */
export default async function FleetPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<ReactNode> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'fleet' });
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
        // Neuer Schlüssel je Firma: Ein Firmenwechsel lädt Listen und Formulare neu.
        <FleetManager
          key={company.companyId}
          companyId={company.companyId}
          canWrite={canManageFleet(company.role)}
        />
      )}
    </>
  );
}
