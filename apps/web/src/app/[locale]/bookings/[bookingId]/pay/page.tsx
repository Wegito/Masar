import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';

import { CheckoutView } from '../../../../../components/checkout-view';
import { SiteHeader } from '../../../../../components/site-header';
import { Link } from '../../../../../i18n/navigation';
import { isUuid } from '../../../../../lib/search';

interface PageProps {
  params: Promise<{ locale: string; bookingId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'checkout' });
  return { title: t('title'), robots: { index: false, follow: false } };
}

/**
 * „Zahlweg wählen" nach dem Hold (Schritt 1.5). Wie die Ticketseite rendert der Server nur den
 * Rahmen: Das Verwaltungstoken steht im Fragment (`#token=`), das der Browser nie an einen Server
 * schickt. Ein Neuladen der Seite behält es, anders als ein Zustand im Speicher.
 */
export default async function PayPage({ params }: PageProps): Promise<ReactNode> {
  const { locale, bookingId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('checkout');
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6">
      <SiteHeader />
      {isUuid(bookingId) ? (
        <>
          <CheckoutView bookingId={bookingId} />
          <noscript>
            <p className="rounded-xl bg-amber-50 p-4 text-amber-900">{t('noScript')}</p>
          </noscript>
        </>
      ) : (
        <div role="alert" className="flex flex-col gap-3 rounded-xl bg-amber-50 p-4 text-amber-900">
          <p>{t('notFound')}</p>
          <Link href="/" prefetch={false} className="self-start underline">
            {t('toSearch')}
          </Link>
        </div>
      )}
    </main>
  );
}
