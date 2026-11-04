import { useTranslations } from 'next-intl';
import { type ReactNode, Suspense } from 'react';

import { Link } from '../i18n/navigation';
import { BrandMark } from './brand-mark';
import { LanguageSwitcher } from './language-switcher';

const LINK =
  'inscription rounded px-3 py-2 text-[11px] text-slate-600 rtl:text-sm hover:text-forest-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700';

/** Kopfzeile aller Seiten: Marke, Suche, „Meine Buchung" und Sprachwechsel. */
export function SiteHeader(): ReactNode {
  const t = useTranslations('header');
  return (
    <header className="sticky top-0 z-40 border-b border-brand-100 bg-mist-50/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
        <BrandMark />
        <nav className="flex items-center gap-1 text-forest-900">
          <Link href="/" className={`${LINK} hidden sm:inline-block`}>
            {t('findTrips')}
          </Link>
          <Link href="/my-booking" prefetch={false} className={LINK}>
            {t('myBooking')}
          </Link>
          {/* useSearchParams braucht eine Suspense-Grenze; der Sprachwechsel ist nicht dringend. */}
          <Suspense fallback={null}>
            <LanguageSwitcher />
          </Suspense>
        </nav>
      </div>
    </header>
  );
}
