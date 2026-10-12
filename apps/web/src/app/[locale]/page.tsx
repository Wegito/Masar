import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';

import { LanguageSwitcher } from '../../components/language-switcher';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function HomePage({ params }: PageProps): Promise<ReactNode> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('home');
  const points = ['seat', 'women', 'payment'] as const;
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-10">
      <header className="flex items-center justify-between gap-4">
        <span className="text-2xl font-bold text-brand-700">{t('brand')}</span>
        <LanguageSwitcher />
      </header>
      <section className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold leading-tight">{t('title')}</h1>
        <p className="text-lg text-slate-600">{t('tagline')}</p>
      </section>
      <ul className="flex flex-col gap-3">
        {points.map((point) => (
          <li key={point} className="rounded-xl border border-slate-200 p-4 text-start">
            <p className="font-semibold">{t(`points.${point}.title`)}</p>
            <p className="text-slate-600">{t(`points.${point}.text`)}</p>
          </li>
        ))}
      </ul>
      <p className="rounded-xl bg-brand-50 p-4 text-brand-900">{t('soon')}</p>
    </main>
  );
}
