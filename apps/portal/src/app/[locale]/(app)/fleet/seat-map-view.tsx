'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { type LayoutSeat, type SeatCell, seatGrid } from '../../../../lib/fleet';

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

/**
 * Sitzplan als Grundriss, Fahrtrichtung oben. Wie in der Fahrgast-App bleibt links links, auch auf
 * Arabisch (`dir="ltr"` am Grundriss). Farben: Sitz mit Nachbar (Sitzregel greift), Einzelsitz
 * ohne Nachbar (2+1), Hinterbank.
 */
export function SeatMapView({
  seats,
  neighbors,
  label,
}: {
  seats: readonly LayoutSeat[];
  neighbors: readonly (readonly [string, string])[];
  label: string;
}): ReactNode {
  const t = useTranslations('fleet.map');
  const grid = seatGrid(seats);
  const paired = new Set(neighbors.flat());
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
              {cells.map((cell) => (
                <span
                  key={cell.label}
                  data-seat={cell.label}
                  className={`${COLUMN_START[cell.gridColumn] ?? ''} row-start-1 flex h-8 items-center justify-center rounded-md border text-xs font-medium tabular-nums ${
                    cell.side === 'BENCH'
                      ? 'border-slate-300 bg-slate-100 text-slate-700'
                      : paired.has(cell.label)
                        ? 'border-brand-300 bg-brand-50 text-brand-900'
                        : 'border-amber-300 bg-amber-50 text-amber-900'
                  }`}
                >
                  {cell.label}
                </span>
              ))}
            </div>
          ))}
      </div>
      <figcaption className="text-center text-xs text-slate-600">{t('legend')}</figcaption>
    </figure>
  );
}
