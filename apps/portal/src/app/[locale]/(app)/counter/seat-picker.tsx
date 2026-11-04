'use client';

import { type Locale } from '@masar/shared';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import {
  type CounterSeat,
  type CounterSeatMap,
  MAX_COUNTER_SEATS,
  occupiedStopPairs,
  type PassengerDraft,
} from '../../../../lib/counter';
import { type SeatCell, seatGrid } from '../../../../lib/fleet';
import { localName } from '../../../../lib/routes';

// Feste Klassen statt Inline-Styles (CSP), wie im Kontingent der Fahrten (`trips/quota-map.tsx`).
const GRID_COLUMNS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
  5: 'grid-cols-5',
  6: 'grid-cols-6',
};
const COLUMN_START: Record<number, string> = {
  1: 'col-start-1',
  2: 'col-start-2',
  3: 'col-start-3',
  4: 'col-start-4',
  5: 'col-start-5',
  6: 'col-start-6',
};

function seatClass(seat: CounterSeat, selected: boolean): string {
  if (selected) return 'border-brand-700 bg-brand-600 text-white';
  if (seat.state === 'BLOCKED') return 'border-slate-300 bg-slate-200 text-slate-500';
  if (seat.state === 'TAKEN') return 'border-slate-300 bg-slate-100 text-slate-400 line-through';
  return seat.quota === 'COUNTER'
    ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
    : 'border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100';
}

/**
 * Schritt 3: Sitzplan des Schalters als Grundriss (Fahrtrichtung oben, `dir="ltr"`), jeder Sitz
 * ein Knopf mit `aria-pressed`. Farbe nach Kontingent, durchgestrichen bei Belegung auf der
 * Teilstrecke. Nur Anzeige; Auswahl und Regeln kommen aus `useCounter`.
 */
export function SeatPicker({
  map,
  selection,
  onToggle,
}: {
  map: CounterSeatMap;
  selection: readonly PassengerDraft[];
  onToggle: (seat: CounterSeat) => void;
}): ReactNode {
  const t = useTranslations('counter.seats');
  const locale = useLocale() as Locale;
  const grid = seatGrid(map.seats);
  const byLabel = new Map(map.seats.map((seat) => [seat.label, seat]));
  const selected = new Set(selection.map((entry) => entry.seatId));
  const rows = new Map<number, SeatCell[]>();
  for (const cell of grid.cells) {
    rows.set(cell.gridRow, [...(rows.get(cell.gridRow) ?? []), cell]);
  }

  function describe(seat: CounterSeat, isSelected: boolean): string {
    const parts = [
      t('seat', { label: seat.label }),
      t(`state.${seat.state}`),
      t(`quota.${seat.quota}`),
    ];
    for (const [from, to] of occupiedStopPairs(seat.occupiedRanges, map.trip.stops)) {
      parts.push(t('takenOn', { from: localName(from, locale), to: localName(to, locale) }));
    }
    if (isSelected) parts.push(t('selected'));
    return parts.join(', ');
  }

  return (
    <section
      aria-labelledby="counter-seats"
      className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="counter-seats" className="text-lg font-semibold">
          {t('heading')}
        </h2>
        <p className="text-sm text-slate-600 tabular-nums">
          {t('summary', {
            free: map.summary.free,
            taken: map.summary.taken,
            counterOnly: map.summary.counterOnly,
          })}
        </p>
      </div>
      <figure className="flex flex-col gap-2">
        <div
          dir="ltr"
          role="group"
          aria-label={t('label')}
          className="mx-auto flex w-full max-w-80 flex-col gap-1.5 rounded-3xl border-2 border-slate-300 bg-white p-3"
        >
          <div className="mb-1 rounded-t-2xl bg-slate-100 px-3 py-1.5 text-center text-xs text-slate-600">
            {t('front')}
          </div>
          {[...rows.entries()]
            .sort(([a], [b]) => a - b)
            .map(([row, cells]) => (
              <div
                key={row}
                className={`grid gap-1.5 ${GRID_COLUMNS[grid.columns] ?? 'grid-cols-6'}`}
              >
                {cells.map((cell) => {
                  const seat = byLabel.get(cell.label);
                  if (seat === undefined) return null;
                  const isSelected = selected.has(seat.seatId);
                  const disabled =
                    !isSelected && (seat.state !== 'FREE' || selection.length >= MAX_COUNTER_SEATS);
                  return (
                    <button
                      key={cell.label}
                      type="button"
                      data-seat={seat.label}
                      data-state={seat.state}
                      data-quota={seat.quota}
                      aria-pressed={isSelected}
                      aria-label={describe(seat, isSelected)}
                      disabled={disabled || !map.salesOpen}
                      onClick={() => onToggle(seat)}
                      className={`${COLUMN_START[cell.gridColumn] ?? ''} row-start-1 flex h-11 items-center justify-center rounded-md border text-xs font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-300 disabled:cursor-not-allowed ${seatClass(seat, isSelected)}`}
                    >
                      {seat.label}
                    </button>
                  );
                })}
              </div>
            ))}
        </div>
        <figcaption className="text-center text-xs text-slate-600">
          {t('legend')} {t('max', { max: MAX_COUNTER_SEATS })}
        </figcaption>
      </figure>
    </section>
  );
}
