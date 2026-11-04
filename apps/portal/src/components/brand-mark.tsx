import type { ReactNode } from 'react';

/** Wortmarke: arabisch klein über MASAR. `dark` für dunklen Grund (Kopfzeile, Anmeldung). */
export function BrandMark({ tone = 'light' }: { tone?: 'light' | 'dark' }): ReactNode {
  const dark = tone === 'dark';
  return (
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
  );
}
