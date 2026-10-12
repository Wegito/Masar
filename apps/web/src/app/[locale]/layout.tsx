import { textDirection } from '@masar/shared';
import type { Metadata, Viewport } from 'next';
import { Inter, Noto_Sans_Arabic } from 'next/font/google';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';

import { ClientErrorReporter } from '../../components/client-error-reporter';
import { routing } from '../../i18n/routing';
import '../globals.css';

// Schriften werden beim Build geladen und selbst ausgeliefert: zur Laufzeit keine Anfrage an Google.
const latin = Inter({ subsets: ['latin'], variable: '--font-latin', display: 'swap' });
const arabic = Noto_Sans_Arabic({
  subsets: ['arabic'],
  variable: '--font-arabic',
  display: 'swap',
});

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

export const viewport: Viewport = { themeColor: '#1674f2', width: 'device-width', initialScale: 1 };

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
      className={`${latin.variable} ${arabic.variable}`}
    >
      <body className="min-h-dvh bg-white text-slate-900 antialiased">
        <ClientErrorReporter />
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
