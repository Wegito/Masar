'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { type SeatCell, seatGrid } from '../../../../lib/fleet';
import { type SeatQuotaState, seatQuotaState, type TripSeat } from '../../../../lib/trips';

// Feste Klassen statt Inline-Styles: Die CSP des Portals erlaubt in Produktion keine
// style-Attribute, und Tailwind erzeugt nur Klassen, die wörtlich im Code stehen.
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
const STATE_CLASS: Record<SeatQuotaState, string> = {
  ONLINE: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  COUNTER: 'border-amber-300 bg-amber-50 text-amber-900',
  BLOCKED: 'border-slate-300 bg-slate-200 text-slate-600',
};

/**
 * Kontingent einer Fahrt als Grundriss, Fahrtrichtung oben, wie der Sitzplan der Flotte
 * (`dir="ltr"`: links bleibt links, auch auf Arabisch). Farbe je Kanal, Punkt für belegte Sitze.
 * Nur Anzeige; das Kontingent ändert die API (`PUT trips/:id/quota`).
 */
export function QuotaMap({
  seats,
  label,
}: {
  seats: readonly TripSeat[];
  label: string;
}): ReactNode {
  const t = useTranslations('trips.detail');
  const grid = seatGrid(seats);
  const byLabel = new Map(seats.map((seat) => [seat.label, seat]));
  const rows = new Map<number, SeatCell[]>();
  for (const cell of grid.cells) {
    rows.set(cell.gridRow, [...(rows.get(cell.gridRow) ?? []), cell]);
  }

  return (
    <figure className="flex flex-col gap-2">
      <div
        dir="ltr"
        role="img"
        aria-label={label}
        className="mx-auto flex w-full max-w-72 flex-col gap-1.5 rounded-3xl border-2 border-slate-300 bg-white p-3"
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
                const state = seat === undefined ? 'BLOCKED' : seatQuotaState(seat);
                return (
                  <span
                    key={cell.label}
                    data-seat={cell.label}
                    data-quota={state}
                    data-occupied={seat?.occupied === true ? 'true' : 'false'}
                    className={`${COLUMN_START[cell.gridColumn] ?? ''} relative row-start-1 flex h-8 items-center justify-center rounded-md border text-xs font-medium tabular-nums ${STATE_CLASS[state]}`}
                  >
                    {cell.label}
                    {seat?.occupied === true ? (
                      <span className="absolute end-0.5 top-0.5 size-1.5 rounded-full bg-slate-800" />
                    ) : null}
                  </span>
                );
              })}
            </div>
          ))}
      </div>
      <figcaption className="text-center text-xs text-slate-600">{t('legend')}</figcaption>
    </figure>
  );
}
