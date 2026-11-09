import { textDirection } from '@masar/shared';
import type { Metadata } from 'next';
import { Amiri, Cinzel, Manrope, Noto_Sans_Arabic, Reem_Kufi } from 'next/font/google';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { ClientErrorReporter } from '../../components/client-error-reporter';
import { routing } from '../../i18n/routing';
import '../globals.css';

const latin = Manrope({ subsets: ['latin'], variable: '--font-latin', display: 'swap' });
const arabic = Noto_Sans_Arabic({
  subsets: ['arabic'],
  variable: '--font-arabic',
  display: 'swap',
});

// Überschriften: eine variable Schrift je Sprache (Cinzel, Amiri); Reem Kufi nur in der Wortmarke.
const displayLatin = Cinzel({
  subsets: ['latin'],
  variable: '--font-display-latin',
  display: 'swap',
});
const displayArabic = Amiri({
  subsets: ['arabic'],
  weight: '700',
  variable: '--font-display-ar',
  display: 'swap',
  preload: false,
});
const brandArabic = Reem_Kufi({
  subsets: ['arabic'],
  variable: '--font-brand-ar',
  display: 'swap',
  preload: false,
});

// Jede Anfrage bekommt einen eigenen CSP-Nonce (src/proxy.ts); statische Seiten hätten keinen.
export const dynamic = 'force-dynamic';

interface LayoutProps {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: Omit<LayoutProps, 'children'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'meta' });
  // Das Portal gehört nicht in Suchmaschinen.
  return { title: t('title'), robots: { index: false, follow: false } };
}

export default async function LocaleLayout({ children, params }: LayoutProps): Promise<ReactNode> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  return (
    <html
      lang={locale}
      dir={textDirection(locale)}
      className={`${latin.variable} ${arabic.variable} ${displayLatin.variable} ${displayArabic.variable} ${brandArabic.variable}`}
    >
      <body className="min-h-dvh bg-mist-50 text-forest-900 antialiased">
        <ClientErrorReporter />
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
