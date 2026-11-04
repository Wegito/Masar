import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Link } from '../i18n/navigation';

/** Wortmarke: arabisch klein in Gold oder Grün über MASAR. */
export function BrandMark({ tone = 'light' }: { tone?: 'light' | 'dark' }): ReactNode {
  const t = useTranslations('header');
  const dark = tone === 'dark';
  return (
    <Link
      href="/"
      aria-label={t('home')}
      className="flex items-center rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-current"
    >
      <span className="flex flex-col leading-none">
        <span
          lang="ar"
          className={`font-brand text-[15px] ${dark ? 'text-gold-400' : 'text-brand-700'}`}
        >
          مسار
        </span>
        <span
          lang="en"
          className={`font-display text-xl tracking-[0.22em] ${dark ? 'text-mist-50' : 'text-forest-900'}`}
        >
          MASAR
        </span>
      </span>
    </Link>
  );
}
