'use client';

import type { Locale } from '@masar/shared';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Link } from '../i18n/navigation';
import { licenseBanner, type LicenseView } from '../lib/license';
import { formatCalendarDay } from '../lib/routes';

const TONE = {
  warning: 'border-amber-300 bg-amber-50 text-amber-950',
  danger: 'border-red-300 bg-red-50 text-red-900',
} as const;

/**
 * Hinweis zum Lizenzstand im Rahmen (Schritt 2.7, ADR 0029): 30 und 7 Tage vor Ablauf, in der
 * Kulanz und danach. Welcher Hinweis gilt, entscheidet `licenseBanner` aus `lib/license.ts`; hier
 * steht nur die Darstellung (austauschbar für das Design).
 */
export function LicenseBanner({ license }: { license: LicenseView }): ReactNode {
  const t = useTranslations('license.banner');
  const locale = useLocale() as Locale;
  const banner = licenseBanner(license);
  if (banner === null) {
    return null;
  }
  return (
    <section
      aria-label={t('label')}
      data-testid="license-banner"
      data-kind={banner.kind}
      className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 text-sm print:hidden ${TONE[banner.tone]}`}
    >
      {/* Ohne Live-Rolle: Der Hinweis steht beim Laden fest, er meldet keine Änderung. */}
      <p>
        {t(banner.kind, {
          days: String(banner.days),
          date: banner.date === null ? '' : formatCalendarDay(banner.date, locale),
        })}
      </p>
      <Link href="/license" className="font-semibold underline">
        {t('link')}
      </Link>
    </section>
  );
}
