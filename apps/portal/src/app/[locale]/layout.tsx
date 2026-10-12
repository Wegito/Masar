import { textDirection } from '@masar/shared';
import type { Metadata } from 'next';
import { Inter, Noto_Sans_Arabic } from 'next/font/google';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { ClientErrorReporter } from '../../components/client-error-reporter';
import { routing } from '../../i18n/routing';
import '../globals.css';

const latin = Inter({ subsets: ['latin'], variable: '--font-latin', display: 'swap' });
const arabic = Noto_Sans_Arabic({
  subsets: ['arabic'],
  variable: '--font-arabic',
  display: 'swap',
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
      className={`${latin.variable} ${arabic.variable}`}
    >
      <body className="min-h-dvh bg-slate-50 text-slate-900 antialiased">
        <ClientErrorReporter />
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
