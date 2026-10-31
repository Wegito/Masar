import { describe, expect, it } from 'vitest';

import { generateSeatLayout, type SeatLayoutBlueprint } from './seat-layout.js';

function neighborsOf(layout: SeatLayoutBlueprint, label: string): string[] {
  return layout.neighbors
    .filter(([a]) => a === label)
    .map(([, b]) => b)
    .sort();
}

function seat(layout: SeatLayoutBlueprint, label: string) {
  const found = layout.seats.find((s) => s.label === label);
  if (!found) {
    throw new Error(`Sitz ${label} fehlt`);
  }
  return found;
}

describe('Sitzplan-Generator', () => {
  const standard45 = generateSeatLayout({ pattern: 'TWO_PLUS_TWO', rows: 10, rearBench: true });
  const vip = generateSeatLayout({ pattern: 'TWO_PLUS_ONE', rows: 11, rearBench: true });

  it('erzeugt den typischen 45-Sitzer: zehn Reihen 2+2 und eine Hinterbank mit fünf Sitzen', () => {
    expect(standard45.seats).toHaveLength(45);
    expect(standard45.seats.filter((s) => s.rowIndex === 10)).toHaveLength(5);
  });

  it('nummeriert lückenlos ab 1, je Reihe von links nach rechts', () => {
    expect(standard45.seats.map((s) => s.label)).toEqual(
      Array.from({ length: 45 }, (_, i) => String(i + 1)),
    );
    expect(seat(standard45, '1')).toMatchObject({ rowIndex: 0, colIndex: 0, side: 'LEFT' });
    expect(seat(standard45, '4')).toMatchObject({ rowIndex: 0, colIndex: 4, side: 'RIGHT' });
  });

  it('lässt im 2+2 die Gangspalte frei, außer auf der Hinterbank', () => {
    const aisleSeats = standard45.seats.filter((s) => s.colIndex === 2);
    expect(aisleSeats).toEqual([{ label: '43', rowIndex: 10, colIndex: 2, side: 'AISLE' }]);
  });

  it('macht Sitze direkt nebeneinander zu Nachbarn, aber nie über den Gang', () => {
    expect(neighborsOf(standard45, '1')).toEqual(['2']);
    expect(neighborsOf(standard45, '2')).toEqual(['1']);
    expect(neighborsOf(standard45, '3')).toEqual(['4']);
  });

  it('gibt dem mittleren Hinterbank-Sitz zwei Nachbarn (Kette statt Gruppe, ADR 0006)', () => {
    expect(neighborsOf(standard45, '43')).toEqual(['42', '44']);
    expect(neighborsOf(standard45, '41')).toEqual(['42']);
    expect(neighborsOf(standard45, '45')).toEqual(['44']);
  });

  it('lässt den Einzelsitz im 2+1 ohne Nachbarn', () => {
    const singles = vip.seats.filter((s) => s.side === 'RIGHT' && s.rowIndex < 11);
    expect(singles).toHaveLength(11);
    for (const single of singles) {
      expect(neighborsOf(vip, single.label)).toEqual([]);
    }
    expect(vip.seats).toHaveLength(11 * 3 + 4);
  });

  it.each([
    ['2+2', standard45],
    ['2+1', vip],
  ])('%s: Paare symmetrisch, ohne Selbstbezug, ohne Dubletten', (_name, layout) => {
    const keys = layout.neighbors.map(([a, b]) => `${a}>${b}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const [a, b] of layout.neighbors) {
      expect(a).not.toBe(b);
      expect(keys).toContain(`${b}>${a}`);
    }
  });

  it.each([
    ['2+2', standard45],
    ['2+1', vip],
  ])('%s: Nachbarn liegen in derselben Reihe und direkt nebeneinander', (_name, layout) => {
    for (const [a, b] of layout.neighbors) {
      const left = seat(layout, a);
      const right = seat(layout, b);
      expect(left.rowIndex).toBe(right.rowIndex);
      expect(Math.abs(left.colIndex - right.colIndex)).toBe(1);
    }
  });

  it('vergibt jede Position nur einmal', () => {
    const positions = standard45.seats.map((s) => `${s.rowIndex}:${s.colIndex}`);
    expect(new Set(positions).size).toBe(positions.length);
  });

  it('kommt ohne Hinterbank aus', () => {
    const layout = generateSeatLayout({ pattern: 'TWO_PLUS_TWO', rows: 2, rearBench: false });
    expect(layout.seats).toHaveLength(8);
    expect(layout.neighbors).toHaveLength(8);
  });

  it.each([0, -1, 2.5, 21])('lehnt %s Reihen ab', (rows) => {
    expect(() => generateSeatLayout({ pattern: 'TWO_PLUS_TWO', rows, rearBench: false })).toThrow(
      RangeError,
    );
  });
});
