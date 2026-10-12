'use client';

import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useState } from 'react';

import { LanguageSwitcher } from '../../components/language-switcher';
import { useRouter } from '../../i18n/navigation';
import { api, type UserSummary } from '../../lib/api';

/** Startseite des Portals: wer angemeldet ist und in welchen Firmen. */
export default function DashboardPage(): ReactNode {
  const t = useTranslations('dashboard');
  const locale = useLocale();
  const router = useRouter();
  const [user, setUser] = useState<UserSummary>();

  useEffect(() => {
    void api<{ user: UserSummary }>('/auth/me').then((result) => {
      if (result.ok) {
        setUser(result.data.user);
      } else {
        router.replace('/auth/login');
      }
    });
  }, [router]);

  async function logout(): Promise<void> {
    await api('/auth/logout', { method: 'POST' });
    router.replace('/auth/login');
  }

  if (!user) {
    return <main className="p-8">{t('loading')}</main>;
  }
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          <button
            type="button"
            onClick={() => void logout()}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
          >
            {t('logout')}
          </button>
        </div>
      </header>
      <p>
        {t('signedInAs', { email: user.email ?? user.displayName })}
        {user.isPlatformAdmin ? (
          <span className="ms-2 rounded-full bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-800">
            {t('platformAdmin')}
          </span>
        ) : null}
      </p>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t('companies')}</h2>
        {user.memberships.length === 0 ? (
          <p className="text-slate-600">{t('noCompanies')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {user.memberships.map((membership) => (
              <li
                key={membership.companyId}
                className="rounded-xl border border-slate-200 bg-white p-4"
              >
                <p className="font-semibold">
                  {locale === 'ar' ? membership.companyNameAr : membership.companyNameEn}
                </p>
                <p className="text-sm text-slate-600">{t(`roles.${membership.role}`)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
