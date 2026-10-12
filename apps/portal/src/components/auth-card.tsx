import type { ReactNode } from 'react';

import { LanguageSwitcher } from './language-switcher';

/** Rahmen der Anmeldeseiten: Titel, Sprachwechsel, Inhalt. */
export function AuthCard({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 py-10">
      <div className="flex items-center justify-between gap-4">
        <span className="text-xl font-bold text-brand-700">
          <span lang="en">Masar</span> · <span lang="ar">مسار</span>
        </span>
        <LanguageSwitcher />
      </div>
      <section className="flex flex-col gap-5 rounded-2xl border border-slate-200 p-6 shadow-sm">
        <h1 className="text-2xl font-bold">{title}</h1>
        {children}
      </section>
    </main>
  );
}
