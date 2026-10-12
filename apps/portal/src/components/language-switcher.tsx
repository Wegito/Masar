'use client';

import type { Locale } from '@masar/shared';
import { useLocale, useTranslations } from 'next-intl';

import { Link, usePathname } from '../i18n/navigation';

/** Wechselt die Sprache und bleibt auf derselben Seite. */
export function LanguageSwitcher(): React.ReactNode {
  const locale = useLocale() as Locale;
  const pathname = usePathname();
  const t = useTranslations('language');
  const other: Locale = locale === 'ar' ? 'en' : 'ar';
  return (
    <Link
      href={pathname}
      locale={other}
      lang={other}
      className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
    >
      {t('switch')}
    </Link>
  );
}
