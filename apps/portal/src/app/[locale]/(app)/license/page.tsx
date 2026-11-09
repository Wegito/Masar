import type { Locale } from '@masar/shared';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { getCompanyLicense, getPortalSession } from '../../../../lib/session';
import { LicenseOverview } from './license-overview';

/**
 * Lizenzstand der gewählten Firma (Schritt 2.7, ADR 0029 und 0032), nur lesend für alle Rollen.
 * Ändern kann ihn nur der Plattform-Admin unter `/admin/companies`.
 */
export default async function LicensePage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<ReactNode> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'license' });
  const session = await getPortalSession();
  const company = session?.company ?? null;
  const license = company === null ? null : await getCompanyLicense(company.companyId);

  return (
    <>
      <section className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-slate-600">{t('intro')}</p>
      </section>
      {company === null ? (
        <p className="rounded-lg bg-amber-50 p-3 text-amber-900">{t('noCompany')}</p>
      ) : license === null ? (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {t('loadFailed')}
        </p>
      ) : (
        <LicenseOverview license={license} />
      )}
    </>
  );
}
