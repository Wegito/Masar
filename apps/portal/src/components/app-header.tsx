'use client';

import type { Locale } from '@masar/shared';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';

import { selectCompany } from '../app/[locale]/(app)/actions';
import { useRouter } from '../i18n/navigation';
import { api, type Problem } from '../lib/api';
import { companyName } from '../lib/company';
import { logoutOutcome } from '../lib/logout';
import { LanguageSwitcher } from './language-switcher';
import { usePortal } from './portal-context';
import { ProblemMessage } from './problem-message';

/** Kopfzeile des angemeldeten Bereichs: Firma (mit Auswahl), Person, Sprache, Abmelden. */
export function AppHeader(): ReactNode {
  const t = useTranslations('shell');
  const tRoles = useTranslations('roles');
  const locale = useLocale() as Locale;
  const { user, company } = usePortal();

  return (
    <header className="border-b border-slate-200 bg-white print:hidden">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-lg font-bold text-brand-700">
            <span lang="en">Masar</span> · <span lang="ar">مسار</span>
          </span>
          {company === null ? (
            <span className="text-sm text-slate-600">{t('noCompany')}</span>
          ) : user.memberships.length > 1 ? (
            <CompanySwitcher />
          ) : (
            <span className="font-semibold" data-testid="company-name">
              {companyName(company, locale)}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-slate-700">
            <span className="font-medium">{user.displayName}</span>
            {company === null ? null : (
              <span className="ms-1 text-slate-500">({tRoles(company.role)})</span>
            )}
            {user.isPlatformAdmin ? (
              <span className="ms-2 rounded-full bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-800">
                {t('platformAdmin')}
              </span>
            ) : null}
          </span>
          <LanguageSwitcher />
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}

/** Auswahl der Firma bei mehreren Mitgliedschaften; die Wahl speichert eine Server Action. */
function CompanySwitcher(): ReactNode {
  const t = useTranslations('shell');
  const locale = useLocale() as Locale;
  const { user, company } = usePortal();
  return (
    <form action={selectCompany} className="flex items-center gap-2">
      <label className="flex items-center gap-2 text-sm">
        <span className="font-medium">{t('company')}</span>
        <select
          name="companyId"
          defaultValue={company?.companyId}
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
          className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 font-semibold"
        >
          {user.memberships.map((membership) => (
            <option key={membership.companyId} value={membership.companyId}>
              {companyName(membership, locale)}
            </option>
          ))}
        </select>
      </label>
      {/* Ohne JavaScript schickt erst diese Schaltfläche die Wahl ab. */}
      <noscript>
        <button type="submit" className="rounded-lg border border-slate-300 px-2 py-1 text-sm">
          {t('switchCompany')}
        </button>
      </noscript>
    </form>
  );
}

/**
 * Abmelden. Zum Login geht es nur, wenn die API die Sitzung widerrufen hat oder sie schon ungültig
 * ist (`logoutOutcome`). Scheitert der Aufruf, bleibt die Person sichtbar angemeldet und sieht
 * eine Fehlermeldung, damit niemand ein geteiltes Gerät mit gültiger Sitzung weitergibt.
 */
function LogoutButton(): ReactNode {
  const t = useTranslations('shell');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{
    problem: Problem;
    retryAfterSeconds?: number | undefined;
  } | null>(null);

  async function logout(): Promise<void> {
    setBusy(true);
    setFailure(null);
    const result = await api('/auth/logout', { method: 'POST' });
    if (!result.ok && logoutOutcome(result) === 'error') {
      setFailure({ problem: result.problem, retryAfterSeconds: result.retryAfterSeconds });
      setBusy(false);
      return;
    }
    router.replace('/auth/login');
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => void logout()}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-60"
      >
        {t('logout')}
      </button>
      {failure === null ? null : (
        <div className="max-w-xs space-y-1" data-testid="logout-failed">
          <p className="text-sm font-semibold text-red-800">{t('logoutFailed')}</p>
          <ProblemMessage problem={failure.problem} retryAfterSeconds={failure.retryAfterSeconds} />
        </div>
      )}
    </div>
  );
}
