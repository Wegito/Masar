import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { BrandMark } from './brand-mark';

/** Fußzeile: dunkles Band mit Marke und einem Satz. Keine Links, die es noch nicht gibt. */
export function SiteFooter(): ReactNode {
  const t = useTranslations('footer');
  return (
    <footer className="mt-auto print:hidden bg-forest-900 text-mist-50">
      <div className="gold-rule" />
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center sm:justify-between">
        <BrandMark tone="dark" />
        <p className="max-w-sm text-sm text-mist-100/80">{t('tagline')}</p>
      </div>
      <p className="mx-auto max-w-6xl border-t border-white/10 px-4 py-4 text-xs text-mist-100/60">
        {t('rights')}
      </p>
    </footer>
  );
}
