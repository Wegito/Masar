'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Link, usePathname } from '../i18n/navigation';
import { isCurrent, NAV_ITEMS, navState } from '../lib/nav';
import { usePortal } from './portal-context';

/**
 * Seitennavigation. Noch nicht gebaute Ziele stehen als deaktivierte Einträge mit „bald" darin,
 * Ziele ohne Berechtigung mit „kein Zugriff"; beide sind kein Link (`aria-disabled`).
 */
export function SideNav(): ReactNode {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const { company, user } = usePortal();

  return (
    <nav aria-label={t('label')} className="md:w-56 md:shrink-0 print:hidden">
      <ul className="flex gap-1 overflow-x-auto md:flex-col">
        {NAV_ITEMS.map((item) => {
          const state = navState(item, company?.role ?? null, user.isPlatformAdmin);
          if (state === 'hidden') {
            return null;
          }
          if (state !== 'enabled' || item.href === null) {
            return (
              <li key={item.key}>
                <span
                  aria-disabled="true"
                  className="flex items-center justify-between gap-2 whitespace-nowrap rounded-md px-3 py-2 text-slate-400"
                >
                  {t(item.key)}
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                    {state === 'soon' ? t('soon') : t('forbidden')}
                  </span>
                </span>
              </li>
            );
          }
          const current = isCurrent(item.href, pathname);
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={current ? 'page' : undefined}
                className={
                  current
                    ? 'block whitespace-nowrap rounded-md border-s-4 border-gold-400 bg-brand-700 px-3 py-2 font-semibold text-white'
                    : 'block whitespace-nowrap rounded-md px-3 py-2 text-slate-700 hover:bg-brand-100'
                }
              >
                {t(item.key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
