'use client';

import type { Locale } from '@masar/shared';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';

import { selectCompany } from '../app/[locale]/(app)/actions';
import { useRouter } from '../i18n/navigation';
import { api } from '../lib/api';
import { companyName } from '../lib/company';
import { BrandMark } from './brand-mark';
import { LanguageSwitcher } from './language-switcher';
import { usePortal } from './portal-context';

/** Kopfzeile des angemeldeten Bereichs: Firma (mit Auswahl), Person, Sprache, Abmelden. */
export function AppHeader(): ReactNode {
  const t = useTranslations('shell');
  const tRoles = useTranslations('roles');
  const locale = useLocale() as Locale;
  const { user, company } = usePortal();

  return (
    <header className="bg-forest-900 text-mist-50 print:hidden">
      <div className="gold-rule" />
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <BrandMark tone="dark" />
          {company === null ? (
            <span className="text-sm text-mist-100/80">{t('noCompany')}</span>
          ) : user.memberships.length > 1 ? (
            <CompanySwitcher />
          ) : (
            <span
              className="border-s border-white/20 ps-3 font-semibold"
              data-testid="company-name"
            >
              {companyName(company, locale)}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-mist-50">
            <span className="font-medium">{user.displayName}</span>
            {company === null ? null : (
              <span className="ms-1 text-mist-100/70">({tRoles(company.role)})</span>
            )}
            {user.isPlatformAdmin ? (
              <span className="ms-2 rounded-full bg-gold-400 px-2 py-0.5 text-xs font-semibold text-forest-950">
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
          className="rounded-md border border-slate-300 bg-white px-2 py-1.5 font-semibold text-slate-900"
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
        <button type="submit" className="rounded-md border border-slate-300 px-2 py-1 text-sm">
          {t('switchCompany')}
        </button>
      </noscript>
    </form>
  );
}

function LogoutButton(): ReactNode {
  const t = useTranslations('shell');
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout(): Promise<void> {
    setBusy(true);
    await api('/auth/logout', { method: 'POST' });
    router.replace('/auth/login');
    router.refresh();
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void logout()}
      className="rounded-md border border-white/30 px-3 py-1.5 text-sm hover:bg-white/10 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-400"
    >
      {t('logout')}
    </button>
  );
}
