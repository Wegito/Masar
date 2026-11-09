import type { Locale } from '@masar/shared';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { Link } from '../../../../../../../i18n/navigation';
import { getPortalSession } from '../../../../../../../lib/session';
import { AdminLicenseEditor } from './admin-license-editor';

/** Lizenz einer Firma setzen, verlängern, Pakete ändern (Schritt 2.7); nur Plattform-Admins. */
export default async function AdminLicensePage({
  params,
}: {
  params: Promise<{ locale: Locale; companyId: string }>;
}): Promise<ReactNode> {
  const { locale, companyId } = await params;
  const t = await getTranslations({ locale, namespace: 'admin' });
  const session = await getPortalSession();

  return (
    <>
      <p>
        <Link
          href="/admin/companies"
          className="text-sm font-medium text-brand-700 hover:underline"
        >
          {t('back')}
        </Link>
      </p>
      {session?.user.isPlatformAdmin === true ? (
        <AdminLicenseEditor companyId={companyId} />
      ) : (
        <>
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
            {t('forbidden')}
          </p>
        </>
      )}
    </>
  );
}
