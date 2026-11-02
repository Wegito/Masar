import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';

import { BookingLookupForm } from '../../../components/booking-lookup-form';
import { SiteHeader } from '../../../components/site-header';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'lookup' });
  return { title: t('title'), robots: { index: false, follow: false } };
}

/** „Meine Buchung": Zugang mit Buchungscode und Telefon (Schritt 1.4, ADR 0009, 0022). */
export default async function MyBookingPage({ params }: PageProps): Promise<ReactNode> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('lookup');
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6">
      <SiteHeader />
      <section className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-slate-700">{t('intro')}</p>
      </section>
      <BookingLookupForm />
    </main>
  );
}
