'use client';

import { useLocale } from 'next-intl';
import type { ReactNode } from 'react';

import { CounterProblem } from './counter-problem';
import { SaleDone } from './sale-done';
import { SaleForm } from './sale-form';
import { SeatPicker } from './seat-picker';
import { TripPicker } from './trip-picker';
import { useCounter } from './use-counter';

/**
 * Schalter (Schritt 2.6): setzt die Bausteine zusammen. Ablauf und API-Aufrufe liegen in
 * `useCounter`, die Darstellung in den einzelnen Komponenten, damit das Design austauschbar bleibt.
 */
export function CounterDesk({ companyId }: { companyId: string }): ReactNode {
  const locale = useLocale() === 'en' ? 'en' : 'ar';
  const counter = useCounter(companyId, locale);

  return (
    <div className="flex flex-col gap-4">
      <TripPicker counter={counter} />
      {counter.map === undefined && counter.failure !== undefined ? (
        <CounterProblem {...counter.failure} />
      ) : null}
      {counter.sold === undefined ? null : (
        <SaleDone companyId={companyId} booking={counter.sold} onNext={counter.startOver} />
      )}
      {counter.map === undefined || counter.sold !== undefined ? null : (
        <div className="grid gap-4 lg:grid-cols-2">
          <SeatPicker map={counter.map} selection={counter.passengers} onToggle={counter.toggle} />
          <SaleForm counter={counter} />
        </div>
      )}
    </div>
  );
}
