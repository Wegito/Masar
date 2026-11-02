import { useTranslations } from 'next-intl';
import { type ReactNode, Suspense } from 'react';

import { Link } from '../i18n/navigation';
import { LanguageSwitcher } from './language-switcher';

/** Kopfzeile aller Seiten: Marke als Link zur Startseite, „Meine Buchung" und Sprachwechsel. */
export function SiteHeader(): ReactNode {
  const t = useTranslations('header');
  return (
    <header className="flex items-center justify-between gap-4">
      <Link
        href="/"
        aria-label={t('home')}
        className="rounded text-2xl font-bold text-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        {t('brand')}
      </Link>
      <div className="flex items-center gap-3">
        <Link
          href="/my-booking"
          prefetch={false}
          className="rounded text-sm font-medium text-brand-700 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          {t('myBooking')}
        </Link>
        {/* useSearchParams braucht eine Suspense-Grenze; der Sprachwechsel ist nicht dringend. */}
        <Suspense fallback={null}>
          <LanguageSwitcher />
        </Suspense>
      </div>
    </header>
  );
}
