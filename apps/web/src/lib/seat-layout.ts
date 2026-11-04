import type { SeatView } from './types';

/**
 * Sitzgitter aus Reihe, Spalte und Seite (reine Funktionen).
 *
 * Die API zählt Spalten ohne Gang: In 2+2 sind 0 und 1 links (`LEFT`), 2 und 3 rechts (`RIGHT`).
 * Die Oberfläche setzt zwischen die Seiten eine leere Spur für den Gang. Die Hinterbank (`BENCH`)
 * hat keinen Gang und läuft als durchgehende Reihe über die ganze Breite.
 */

export interface SeatCell {
  seat: SeatView;
  /** Spur im Gitter ab 1, in Fahrtrichtung von links nach rechts. */
  track: number;
}

export interface SeatRow {
  /** Reihennummer ab 1, wie in den Beschriftungen. */
  number: number;
  bench: boolean;
  cells: SeatCell[];
}

export interface SeatGrid {
  /** Spuren insgesamt: linke Sitze, Gang, rechte Sitze; mindestens so breit wie die Hinterbank. */
  tracks: number;
  /** Spur des Gangs; `null`, wenn es nur Hinterbänke gibt. */
  aisleTrack: number | null;
  rows: SeatRow[];
}

export function buildSeatGrid(seats: readonly SeatView[]): SeatGrid {
  const leftColumns = Math.max(
    0,
    ...seats.filter((seat) => seat.side === 'LEFT').map((s) => s.column + 1),
  );
  const rightColumns = Math.max(
    0,
    ...seats.filter((seat) => seat.side === 'RIGHT').map((s) => s.column + 1 - leftColumns),
  );
  const benchColumns = Math.max(
    0,
    ...seats.filter((seat) => seat.side === 'BENCH').map((s) => s.column + 1),
  );
  const hasAisle = leftColumns + rightColumns > 0;
  const tracks = Math.max(hasAisle ? leftColumns + 1 + rightColumns : 0, benchColumns, 1);

  const byRow = new Map<number, SeatView[]>();
  for (const seat of seats) {
    byRow.set(seat.row, [...(byRow.get(seat.row) ?? []), seat]);
  }
  const rows = [...byRow.entries()]
    .sort(([a], [b]) => a - b)
    .map(([row, rowSeats]): SeatRow => {
      const bench = rowSeats.every((seat) => seat.side === 'BENCH');
      const cells = [...rowSeats]
        .sort((a, b) => a.column - b.column)
        .map((seat): SeatCell => ({
          seat,
          track: seat.column + 1 + (seat.side === 'RIGHT' ? 1 : 0),
        }));
      return { number: row + 1, bench, cells };
    });
  return { tracks, aisleTrack: hasAisle ? leftColumns + 1 : null, rows };
}
