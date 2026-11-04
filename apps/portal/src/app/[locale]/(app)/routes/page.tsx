import type { Locale } from '@masar/shared';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { canManageRoutes } from '../../../../lib/routes';
import { getPortalSession } from '../../../../lib/session';
import { RoutesManager } from './routes-manager';

/**
 * Strecken der gewählten Firma (Schritt 2.3): Liste, Anlegen mit Haltestellen in Reihenfolge und
 * Tarifmatrix, Ansehen, Archivieren, dazu die Stornoregeln. Lesen dürfen alle Rollen, Schreiben
 * nur Admins; die API prüft beides selbst.
 */
export default async function RoutesPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<ReactNode> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'routes' });
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
        <RoutesManager
          key={company.companyId}
          companyId={company.companyId}
          canWrite={canManageRoutes(company.role)}
        />
      )}
    </>
  );
}
