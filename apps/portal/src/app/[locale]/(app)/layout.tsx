import type { ReactNode } from 'react';

import { AppHeader } from '../../../components/app-header';
import { LicenseBanner } from '../../../components/license-banner';
import { PortalProvider } from '../../../components/portal-context';
import { SideNav } from '../../../components/side-nav';
import { redirect } from '../../../i18n/navigation';
import { licenseBanner } from '../../../lib/license';
import { getCompanyLicense, getPortalSession } from '../../../lib/session';

interface LayoutProps {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}

/**
 * Rahmen des angemeldeten Bereichs (Schritt 2.1, ADR 0025). Der Proxy leitet ohne
 * Sitzungs-Cookie schon vorher zum Login; hier prüft der Server die Sitzung verbindlich über
 * `GET /auth/me`. Seiten, die Daten laden, prüfen zusätzlich selbst: Ein Layout rendert bei
 * Navigation im Client nicht neu, und die API lehnt ohne gültige Sitzung ohnehin ab.
 *
 * Neue Bereiche (etwa `fleet/`) legen nur ihre Seiten in diesen Ordner; Firma und Person liefern
 * `useCompany()` und `usePortal()` aus `components/portal-context.tsx`, auf dem Server
 * `getPortalSession()` aus `lib/session.ts`.
 */
export default async function AppLayout({ children, params }: LayoutProps): Promise<ReactNode> {
  const { locale } = await params;
  const session = await getPortalSession();
  if (session === null) {
    redirect({ href: '/auth/login', locale });
    return null;
  }
  // Lizenz-Hinweis (Schritt 2.7): nur mit Firma; ein Fehler beim Laden blendet ihn aus.
  const license =
    session.company === null ? null : await getCompanyLicense(session.company.companyId);
  return (
    <PortalProvider value={session}>
      <AppHeader />
      {license === null || licenseBanner(license) === null ? null : (
        <div className="mx-auto max-w-6xl px-4 pt-4">
          <LicenseBanner license={license} />
        </div>
      )}
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 md:flex-row">
        <SideNav />
        <main className="flex min-w-0 flex-1 flex-col gap-6">{children}</main>
      </div>
    </PortalProvider>
  );
}
