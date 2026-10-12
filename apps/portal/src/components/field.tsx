import type { InputHTMLAttributes, ReactNode } from 'react';

/** Beschriftetes Eingabefeld. E-Mail und Passwort bleiben auch in Arabisch links-nach-rechts. */
export function Field({
  label,
  hint,
  ...input
}: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>): ReactNode {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <input
        {...input}
        className="rounded-lg border border-slate-300 px-3 py-2 text-start focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
      />
      {hint === undefined ? null : <span className="text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function SubmitButton({
  children,
  busy,
}: {
  children: ReactNode;
  busy: boolean;
}): ReactNode {
  return (
    <button
      type="submit"
      disabled={busy}
      className="rounded-lg bg-brand-600 px-4 py-2.5 font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
    >
      {children}
    </button>
  );
}
