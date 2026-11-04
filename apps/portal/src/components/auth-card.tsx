import type { ReactNode } from 'react';

import { BrandMark } from './brand-mark';
import { LanguageSwitcher } from './language-switcher';

/** Rahmen der Anmeldeseiten: Titel, Sprachwechsel, Inhalt. */
export function AuthCard({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <div className="min-h-dvh bg-linear-to-b from-forest-950 to-forest-800">
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 py-10">
        <div className="flex items-center justify-between gap-4 text-mist-50">
          <BrandMark tone="dark" />
          <LanguageSwitcher />
        </div>
        <section className="flex flex-col gap-5 rounded-md bg-mist-50 p-6 text-forest-900 shadow-xl shadow-black/30">
          <div className="gold-rule w-24" />
          <h1 className="text-2xl">{title}</h1>
          {children}
        </section>
      </main>
    </div>
  );
}
