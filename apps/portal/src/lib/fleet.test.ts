import { describe, expect, it } from 'vitest';

import { canManageFleet, type LayoutSeat, seatGrid } from './fleet';

function seat(label: string, row: number, column: number, side: LayoutSeat['side']): LayoutSeat {
  return { label, row, column, side };
}

describe('seatGrid', () => {
  it('setzt in 2+2 eine Gangspalte zwischen die Seiten', () => {
    const grid = seatGrid([
      seat('1A', 0, 0, 'LEFT'),
      seat('1B', 0, 1, 'LEFT'),
      seat('1C', 0, 2, 'RIGHT'),
      seat('1D', 0, 3, 'RIGHT'),
    ]);
    expect(grid).toMatchObject({ columns: 5, rows: 1, aisleColumn: 3 });
    expect(grid.cells.map((cell) => cell.gridColumn)).toEqual([1, 2, 4, 5]);
  });

  it('legt die Hinterbank über die volle Breite, ohne Gang', () => {
    const grid = seatGrid([
      seat('1A', 0, 0, 'LEFT'),
      seat('1B', 0, 1, 'LEFT'),
      seat('1C', 0, 2, 'RIGHT'),
      seat('2A', 1, 0, 'BENCH'),
      seat('2B', 1, 1, 'BENCH'),
      seat('2C', 1, 2, 'BENCH'),
      seat('2D', 1, 3, 'BENCH'),
    ]);
    expect(grid).toMatchObject({ columns: 4, rows: 2, aisleColumn: 3 });
    expect(grid.cells.filter((cell) => cell.side === 'BENCH').map((c) => c.gridColumn)).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it('wird breiter, wenn die Hinterbank mehr Sitze hat als eine Reihe', () => {
    const bench = [0, 1, 2, 3, 4, 5].map((column) => seat(`2${column}`, 1, column, 'BENCH'));
    const grid = seatGrid([seat('1A', 0, 0, 'LEFT'), seat('1B', 0, 1, 'RIGHT'), ...bench]);
    expect(grid.columns).toBe(6);
  });

  it('ergibt ein leeres Raster ohne Sitze', () => {
    expect(seatGrid([])).toEqual({ columns: 0, rows: 0, aisleColumn: null, cells: [] });
  });
});

describe('canManageFleet', () => {
  it('erlaubt nur Admins', () => {
    expect(canManageFleet('ADMIN')).toBe(true);
    expect(canManageFleet('AGENT')).toBe(false);
    expect(canManageFleet('DRIVER')).toBe(false);
  });
});
