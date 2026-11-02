'use client';

import type { Locale } from '@masar/shared';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useSyncExternalStore } from 'react';

import { Link, usePathname } from '../i18n/navigation';

function subscribeHash(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

/**
 * Wechselt die Sprache und bleibt auf derselben Seite, samt Suchparametern (Städte, Tag, Anzahl).
 * Das gewählte Geschlecht steht nie in der URL und geht beim Wechsel verloren (ADR 0019).
 * Das Fragment bleibt erhalten: Auf der Ticketseite trägt es das Token (`#token=`, ADR 0022). Es
 * existiert nur im Browser; der Server rendert den Link ohne.
 */
export function LanguageSwitcher(): React.ReactNode {
  const locale = useLocale() as Locale;
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const hash = useSyncExternalStore(
    subscribeHash,
    () => window.location.hash,
    () => '',
  );
  const t = useTranslations('language');
  const other: Locale = locale === 'ar' ? 'en' : 'ar';
  return (
    <Link
      href={`${search === '' ? pathname : `${pathname}?${search}`}${hash}`}
      locale={other}
      lang={other}
      prefetch={false}
      className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
    >
      {t('switch')}
    </Link>
  );
}
