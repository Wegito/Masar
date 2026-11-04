import { formatDate, type Locale } from '@masar/shared';
import Form from 'next/form';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { localizedName } from '../lib/format';
import { calendarDateInstant, dateOptions, MAX_PASSENGERS } from '../lib/search';
import type { City } from '../lib/types';

export interface SearchDefaults {
  from?: string;
  to?: string;
  date?: string;
  passengers?: number;
}

const FIELD =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-base text-slate-900 focus-visible:border-brand-600 focus-visible:outline-2 focus-visible:outline-brand-600';

/**
 * Suchformular als GET auf die Ergebnisseite. Ohne JavaScript schickt der Browser das Formular
 * selbst ab; mit JavaScript navigiert `next/form` im Client. Nur native Felder: Die Datumsauswahl
 * ist eine Liste formatierter Tage, damit Ziffern und Monatsnamen der Seite folgen und nicht der
 * Sprache des Geräts.
 */
export function SearchForm({
  cities,
  locale,
  today,
  defaults = {},
}: {
  cities: readonly City[];
  locale: Locale;
  today: string;
  defaults?: SearchDefaults;
}): ReactNode {
  const t = useTranslations('searchForm');
  const sorted = [...cities].sort((a, b) =>
    localizedName(a, locale).localeCompare(localizedName(b, locale), locale),
  );
  const days = dateOptions(today);
  const selectedDate =
    defaults.date !== undefined && days.includes(defaults.date) ? defaults.date : today;

  const dayLabel = (date: string, index: number): string => {
    const formatted = formatDate(calendarDateInstant(date), locale, 'full');
    if (index === 0) {
      return t('today', { date: formatted });
    }
    return index === 1 ? t('tomorrow', { date: formatted }) : formatted;
  };

  return (
    <Form
      action={`/${locale}/search`}
      aria-labelledby="search-heading"
      className="flex flex-col gap-4 rounded-lg bg-mist-50 p-4 text-slate-900 shadow-xl shadow-black/30 sm:p-5"
    >
      <h2 id="search-heading" className="font-display text-2xl text-brand-900">
        {t('heading')}
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.3fr_0.8fr_auto] lg:items-end">
        {(['from', 'to'] as const).map((field) => (
          <label key={field} className="flex flex-col gap-1">
            <span className="text-sm font-medium text-slate-700">{t(field)}</span>
            <select name={field} required defaultValue={defaults[field] ?? ''} className={FIELD}>
              <option value="" disabled>
                {t('chooseCity')}
              </option>
              {sorted.map((city) => (
                <option key={city.id} value={city.id}>
                  {localizedName(city, locale)}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-slate-700">{t('date')}</span>
          <select name="date" required defaultValue={selectedDate} className={FIELD}>
            {days.map((date, index) => (
              <option key={date} value={date}>
                {dayLabel(date, index)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-slate-700">{t('passengers')}</span>
          <select
            name="passengers"
            defaultValue={String(defaults.passengers ?? 1)}
            className={FIELD}
          >
            {Array.from({ length: MAX_PASSENGERS }, (_, index) => index + 1).map((count) => (
              <option key={count} value={String(count)}>
                {t('passengerCount', { count, label: String(count) })}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="rounded-md bg-crimson-600 px-6 py-3 text-base font-semibold text-white hover:bg-crimson-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-crimson-600 sm:col-span-2 lg:col-span-1"
        >
          {t('submit')}
        </button>
      </div>
    </Form>
  );
}
