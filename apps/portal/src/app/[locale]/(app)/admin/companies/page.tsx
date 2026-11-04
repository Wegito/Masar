import type { Locale } from '@masar/shared';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { getPortalSession } from '../../../../../lib/session';
import { AdminCompanies } from './admin-companies';

/**
 * Plattform-Verwaltung (Schritt 2.7, ADR 0032): alle Firmen mit Lizenzstand. Minimaler erster
 * Admin-Bereich; Firmen anlegen und sperren folgt (docs/architektur.md). Die API prüft das Flag
 * `isPlatformAdmin` selbst, die Seite blendet den Inhalt nur aus.
 */
export default async function AdminCompaniesPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<ReactNode> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'admin' });
  const session = await getPortalSession();

  return (
    <>
      <section className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-slate-600">{t('intro')}</p>
      </section>
      {session?.user.isPlatformAdmin === true ? (
        <AdminCompanies />
      ) : (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {t('forbidden')}
        </p>
      )}
    </>
  );
}
