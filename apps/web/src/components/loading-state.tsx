import type { ReactNode } from 'react';

/**
 * Platzhalter, solange der Server die Daten holt (loading.tsx). Ohne Animation, die auf schwachen
 * Geräten Strom kostet; der Text sagt Screenreadern, was passiert.
 */
export function LoadingState({ label, cards = 3 }: { label: string; cards?: number }): ReactNode {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6" aria-busy="true">
      <div className="h-8 w-24 rounded bg-slate-100" />
      <p role="status" className="text-slate-600">
        {label}
      </p>
      {Array.from({ length: cards }, (_, index) => (
        <div key={index} className="h-32 rounded-2xl border border-slate-100 bg-slate-50" />
      ))}
    </main>
  );
}
