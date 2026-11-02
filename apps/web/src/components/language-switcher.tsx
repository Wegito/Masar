'use client';

import type { Locale } from '@masar/shared';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';

import { Link, usePathname } from '../i18n/navigation';

/**
 * Wechselt die Sprache und bleibt auf derselben Seite, samt Suchparametern (Städte, Tag, Anzahl).
 * Das gewählte Geschlecht steht nie in der URL und geht beim Wechsel verloren (ADR 0019).
 */
export function LanguageSwitcher(): React.ReactNode {
  const locale = useLocale() as Locale;
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const t = useTranslations('language');
  const other: Locale = locale === 'ar' ? 'en' : 'ar';
  return (
    <Link
      href={search === '' ? pathname : `${pathname}?${search}`}
      locale={other}
      lang={other}
      prefetch={false}
      className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
    >
      {t('switch')}
    </Link>
  );
}
