import { textDirection } from '@masar/shared';
import type { Metadata, Viewport } from 'next';
import { Amiri, Cinzel, Manrope, Noto_Sans_Arabic, Reem_Kufi } from 'next/font/google';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';

import { SiteFooter } from '../../components/site-footer';
import { ClientErrorReporter } from '../../components/client-error-reporter';
import { routing } from '../../i18n/routing';
import '../globals.css';

// Schriften werden beim Build geladen und selbst ausgeliefert: zur Laufzeit keine Anfrage an Google.
const latin = Manrope({ subsets: ['latin'], variable: '--font-latin', display: 'swap' });
const arabic = Noto_Sans_Arabic({
  subsets: ['arabic'],
  variable: '--font-arabic',
  display: 'swap',
});

// Überschriften: eine variable Schrift je Sprache (Cinzel, Amiri), wenig Last im schwachen Netz.
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
// Reem Kufi nur für das arabische Wort in der Wortmarke.
const brandArabic = Reem_Kufi({
  subsets: ['arabic'],
  variable: '--font-brand-ar',
  display: 'swap',
  preload: false,
});

// Suche und Sitzplan hängen an der Anfrage, und jede Antwort trägt einen eigenen CSP-Nonce
// (src/proxy.ts); statisch vorgerenderte Seiten hätten keinen.
export const dynamic = 'force-dynamic';

interface LayoutProps {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}

export function generateStaticParams(): { locale: string }[] {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: Omit<LayoutProps, 'children'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'meta' });
  return { title: t('title'), description: t('description') };
}

export const viewport: Viewport = { themeColor: '#0c2118', width: 'device-width', initialScale: 1 };

export default async function LocaleLayout({ children, params }: LayoutProps): Promise<ReactNode> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);
  return (
    <html
      lang={locale}
      dir={textDirection(locale)}
      className={`${latin.variable} ${arabic.variable} ${displayLatin.variable} ${displayArabic.variable} ${brandArabic.variable}`}
    >
      <body className="flex min-h-dvh flex-col bg-mist-50 text-forest-900 antialiased">
        <ClientErrorReporter />
        <NextIntlClientProvider>
          {children}
          <SiteFooter />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
