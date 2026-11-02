import type { SeatSide, SeatState } from '@masar/shared';
import { describe, expect, it } from 'vitest';

import { buildSeatGrid, keepSelectable, toggleSeat } from './seat-layout';
import type { SeatView } from './types';

function seat(
  label: string,
  row: number,
  column: number,
  side: SeatSide,
  state: SeatState = 'FREE',
): SeatView {
  return { seatId: label, label, row, column, side, state };
}

/** 2+2 mit zwei Reihen und einer Hinterbank aus fünf Sitzen, wie der Demo-Bus in klein. */
const COACH: SeatView[] = [
  seat('1A', 0, 0, 'LEFT'),
  seat('1B', 0, 1, 'LEFT'),
  seat('1C', 0, 2, 'RIGHT'),
  seat('1D', 0, 3, 'RIGHT'),
  seat('2A', 1, 0, 'LEFT', 'TAKEN'),
  seat('2B', 1, 1, 'LEFT'),
  seat('2C', 1, 2, 'RIGHT', 'NOT_FOR_YOU'),
  seat('2D', 1, 3, 'RIGHT'),
  seat('3A', 2, 0, 'BENCH'),
  seat('3B', 2, 1, 'BENCH'),
  seat('3C', 2, 2, 'BENCH'),
  seat('3D', 2, 3, 'BENCH'),
  seat('3E', 2, 4, 'BENCH', 'BLOCKED'),
];

describe('Sitzgitter', () => {
  it('setzt in 2+2 einen Gang zwischen die Seiten', () => {
    const grid = buildSeatGrid(COACH);
    expect(grid.tracks).toBe(5);
    expect(grid.aisleTrack).toBe(3);
    expect(grid.rows[0]?.cells.map((cell) => [cell.seat.label, cell.track])).toEqual([
      ['1A', 1],
      ['1B', 2],
      ['1C', 4],
      ['1D', 5],
    ]);
  });

  it('legt die Hinterbank als durchgehende Reihe über alle Spuren', () => {
    const bench = buildSeatGrid(COACH).rows[2];
    expect(bench?.bench).toBe(true);
    expect(bench?.number).toBe(3);
    expect(bench?.cells.map((cell) => cell.track)).toEqual([1, 2, 3, 4, 5]);
  });

  it('kommt mit 2+1 und einer breiteren Hinterbank zurecht', () => {
    const grid = buildSeatGrid([
      seat('1A', 0, 0, 'LEFT'),
      seat('1B', 0, 1, 'LEFT'),
      seat('1C', 0, 2, 'RIGHT'),
      ...['A', 'B', 'C', 'D', 'E', 'F'].map((letter, column) =>
        seat(`2${letter}`, 1, column, 'BENCH'),
      ),
    ]);
    expect(grid.aisleTrack).toBe(3);
    expect(grid.tracks).toBe(6);
    expect(grid.rows[0]?.cells.map((cell) => cell.track)).toEqual([1, 2, 4]);
  });

  it('sortiert Reihen und Sitze unabhängig von der Reihenfolge der API', () => {
    const grid = buildSeatGrid([...COACH].reverse());
    expect(grid.rows.map((row) => row.number)).toEqual([1, 2, 3]);
    expect(grid.rows[0]?.cells[0]?.seat.label).toBe('1A');
  });
});

describe('Auswahl', () => {
  it('wählt bis zur Anzahl Fahrgäste und hält die Reihenfolge', () => {
    let selected = toggleSeat([], '1C', 2);
    selected = toggleSeat(selected, '1A', 2);
    expect(selected).toEqual(['1C', '1A']);
    expect(toggleSeat(selected, '1B', 2)).toEqual(['1C', '1A']);
  });

  it('wählt einen Sitz auch bei voller Auswahl wieder ab', () => {
    expect(toggleSeat(['1C', '1A'], '1C', 2)).toEqual(['1A']);
  });

  it('behält nach neuem Sitzplan nur noch freie Sitze', () => {
    expect(keepSelectable(['1A', '2A', '2C', 'weg'], COACH)).toEqual(['1A']);
  });
});
