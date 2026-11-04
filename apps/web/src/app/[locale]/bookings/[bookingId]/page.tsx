import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';

import { SiteHeader } from '../../../../components/site-header';
import { TicketView } from '../../../../components/ticket-view';
import { Link } from '../../../../i18n/navigation';
import { isUuid } from '../../../../lib/search';

interface PageProps {
  params: Promise<{ locale: string; bookingId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'ticket' });
  return { title: t('title'), robots: { index: false, follow: false } };
}

/**
 * Ticketseite (Schritt 1.4, ADR 0022). Der Server rendert nur den Rahmen: Das Token steht im
 * Fragment (`#token=`), das der Browser nie an den Server schickt. Daten und QR-Codes lädt
 * `TicketView` per Server Action; ohne Netz zeigt sie die gespeicherte Kopie.
 */
export default async function TicketPage({ params }: PageProps): Promise<ReactNode> {
  const { locale, bookingId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('ticket');
  return (
    <>
      <div className="print:hidden">
        <SiteHeader />
      </div>
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pt-6 pb-12 print:max-w-none print:p-0">
        {isUuid(bookingId) ? (
          <>
            <TicketView bookingId={bookingId} />
            <noscript>
              <p className="rounded-lg bg-amber-50 p-4 text-amber-900">{t('noScript')}</p>
            </noscript>
          </>
        ) : (
          <div
            role="alert"
            className="flex flex-col gap-3 rounded-lg bg-amber-50 p-4 text-amber-900"
          >
            <p>{t('notFound')}</p>
            <Link href="/my-booking" prefetch={false} className="self-start underline">
              {t('openBooking')}
            </Link>
          </div>
        )}
      </main>
    </>
  );
}
