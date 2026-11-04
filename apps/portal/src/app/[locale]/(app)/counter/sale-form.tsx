'use client';

import { GENDERS, type Locale } from '@masar/shared';
import { useLocale, useTranslations } from 'next-intl';
import type { FormEvent, ReactNode } from 'react';

import { formatTotal } from '../../../../lib/booking';
import { genderWarning } from '../../../../lib/counter';
import { CounterProblem } from './counter-problem';
import type { CounterState } from './use-counter';

const CONTROL =
  'rounded-lg border border-slate-300 bg-white px-3 py-2 text-start focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200';

/**
 * Schritte 4 und 5 mit Preis und Verkaufen: Fahrgast je gewähltem Sitz (Name, Geschlecht, Ausweis
 * nur wenn verlangt), Kontakt, Preis aus der Vorschau der API. Nur Anzeige; Zustand und Aufrufe
 * kommen aus `useCounter`.
 */
export function SaleForm({ counter }: { counter: CounterState }): ReactNode {
  const t = useTranslations('counter');
  const locale = useLocale() as Locale;
  const { map, passengers, contact, quote } = counter;
  if (map === undefined) return null;
  const seatById = new Map(map.seats.map((seat) => [seat.seatId, seat]));

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void counter.sell();
  }

  return (
    <form onSubmit={submit} aria-label={t('title')} className="flex flex-col gap-4" noValidate>
      <section
        aria-labelledby="counter-passengers"
        className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4"
      >
        <h2 id="counter-passengers" className="text-lg font-semibold">
          {t('passengers.heading')}
        </h2>
        {map.genderRuleEnabled ? (
          <p className="text-sm text-slate-600">{t('passengers.genderHint')}</p>
        ) : null}
        {passengers.length === 0 ? (
          <p className="text-sm text-slate-600">{t('passengers.none')}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {passengers.map((passenger) => {
              const warn = genderWarning(seatById.get(passenger.seatId), passenger.gender);
              return (
                <li
                  key={passenger.seatId}
                  data-passenger-seat={passenger.label}
                  className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-3"
                >
                  <p className="font-medium sm:col-span-3">
                    {t('passengers.seat', { label: passenger.label })}
                  </p>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium">{t('passengers.fullName')}</span>
                    <input
                      value={passenger.fullName}
                      onChange={(event) =>
                        counter.updatePassenger(
                          passenger.seatId,
                          'fullName',
                          event.currentTarget.value,
                        )
                      }
                      autoComplete="off"
                      maxLength={100}
                      className={CONTROL}
                    />
                    <span className="text-xs text-slate-500">{t('passengers.fullNameHint')}</span>
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium">{t('passengers.gender')}</span>
                    <select
                      value={passenger.gender}
                      onChange={(event) =>
                        counter.updatePassenger(
                          passenger.seatId,
                          'gender',
                          event.currentTarget.value,
                        )
                      }
                      required={map.genderRuleEnabled}
                      aria-invalid={warn}
                      className={CONTROL}
                    >
                      <option value="">{t('passengers.chooseGender')}</option>
                      {GENDERS.map((gender) => (
                        <option key={gender} value={gender}>
                          {t(`passengers.genders.${gender}`)}
                        </option>
                      ))}
                    </select>
                    {warn ? (
                      <span className="text-xs text-amber-800">
                        {t('passengers.genderWarning')}
                      </span>
                    ) : null}
                  </label>
                  {map.nationalIdRequired ? (
                    <label className="flex flex-col gap-1.5">
                      <span className="text-sm font-medium">{t('passengers.nationalId')}</span>
                      <input
                        value={passenger.nationalId}
                        onChange={(event) =>
                          counter.updatePassenger(
                            passenger.seatId,
                            'nationalId',
                            event.currentTarget.value,
                          )
                        }
                        dir="ltr"
                        inputMode="numeric"
                        autoComplete="off"
                        maxLength={64}
                        className={CONTROL}
                      />
                      <span className="text-xs text-slate-500">
                        {t('passengers.nationalIdHint')}
                      </span>
                    </label>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section
        aria-labelledby="counter-contact"
        className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-3"
      >
        <h2 id="counter-contact" className="text-lg font-semibold sm:col-span-3">
          {t('contact.heading')}
        </h2>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t('contact.name')}</span>
          <input
            value={contact.name}
            onChange={(event) => counter.updateContact('name', event.currentTarget.value)}
            autoComplete="off"
            maxLength={100}
            aria-invalid={counter.invalid === 'contactName'}
            className={CONTROL}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t('contact.phone')}</span>
          <input
            value={contact.phone}
            onChange={(event) => counter.updateContact('phone', event.currentTarget.value)}
            dir="ltr"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            maxLength={40}
            aria-invalid={counter.invalid === 'phone'}
            className={CONTROL}
          />
          <span className="text-xs text-slate-500">{t('contact.phoneHint')}</span>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t('contact.email')}</span>
          <input
            value={contact.email}
            onChange={(event) => counter.updateContact('email', event.currentTarget.value)}
            dir="ltr"
            type="email"
            autoComplete="off"
            maxLength={254}
            className={CONTROL}
          />
        </label>
      </section>

      <section
        aria-labelledby="counter-price"
        className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4"
      >
        <h2 id="counter-price" className="text-lg font-semibold">
          {t('price.heading')}
        </h2>
        {quote === undefined ? (
          <p className="text-sm text-slate-600">{t('price.none')}</p>
        ) : (
          <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <div className="flex gap-2">
              <dt className="sr-only">{t('price.heading')}</dt>
              <dd className="text-slate-600 tabular-nums">
                {t('price.perSeat', { amount: formatTotal(quote.fare, locale) })}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-medium">{t('price.total')}</dt>
              <dd data-testid="counter-total" className="text-lg font-bold tabular-nums">
                {formatTotal(quote.total, locale)}
              </dd>
            </div>
          </dl>
        )}
        {counter.quoteFailure === undefined ? null : <CounterProblem {...counter.quoteFailure} />}
        {counter.invalid === undefined ? null : (
          <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
            {t(`invalid.${counter.invalid}`)}
          </p>
        )}
        {counter.failure === undefined ? null : <CounterProblem {...counter.failure} />}
        <p className="text-xs text-slate-500">{t('cashHint')}</p>
        <button
          type="submit"
          disabled={counter.busy || !map.salesOpen || passengers.length === 0}
          className="rounded-lg bg-brand-600 px-4 py-2.5 font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {counter.busy
            ? t('selling')
            : quote === undefined
              ? t('sellNoPrice')
              : t('sell', { amount: formatTotal(quote.total, locale) })}
        </button>
      </section>
    </form>
  );
}
