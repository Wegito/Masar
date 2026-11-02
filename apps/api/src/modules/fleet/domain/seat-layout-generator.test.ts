import { describe, expect, it } from 'vitest';

import { generateSeatLayout } from './seat-layout-generator.js';

/** Alle Nachbarn eines Sitzes (Paare sind ungerichtet gespeichert). */
function neighborsOf(label: string, pairs: readonly (readonly [string, string])[]): string[] {
  return pairs.flatMap(([a, b]) => (a === label ? [b] : b === label ? [a] : [])).sort();
}

describe('generateSeatLayout', () => {
  it('2+2: je Reihe vier Sitze, Paare links und rechts vom Gang', () => {
    const { seats, neighbors } = generateSeatLayout({ pattern: '2+2', rows: 2 });
    expect(seats.map((s) => s.label)).toEqual(['1A', '1B', '1C', '1D', '2A', '2B', '2C', '2D']);
    expect(neighbors).toHaveLength(4);
    expect(neighborsOf('1A', neighbors)).toEqual(['1B']);
    expect(neighborsOf('1B', neighbors)).toEqual(['1A']);
    expect(neighborsOf('1C', neighbors)).toEqual(['1D']);
    // Über den Gang hinweg sind Sitze keine Nachbarn.
    expect(neighborsOf('1B', neighbors)).not.toContain('1C');
  });

  it('2+2: Seite und Position stimmen', () => {
    const { seats } = generateSeatLayout({ pattern: '2+2', rows: 1 });
    expect(seats.map((s) => [s.label, s.side, s.rowIndex, s.colIndex])).toEqual([
      ['1A', 'LEFT', 0, 0],
      ['1B', 'LEFT', 0, 1],
      ['1C', 'RIGHT', 0, 2],
      ['1D', 'RIGHT', 0, 3],
    ]);
  });

  it('2+1 (VIP): Einzelsitz hat keinen Nachbarn', () => {
    const { seats, neighbors } = generateSeatLayout({ pattern: '2+1', rows: 3 });
    expect(seats).toHaveLength(9);
    expect(neighbors).toHaveLength(3);
    expect(neighborsOf('1A', neighbors)).toEqual(['1B']);
    expect(neighborsOf('1C', neighbors)).toEqual([]);
    expect(seats.find((s) => s.label === '2C')?.side).toBe('RIGHT');
  });

  it('Hinterbank mit fünf Sitzen bildet eine Kette, der mittlere Sitz hat zwei Nachbarn', () => {
    const { seats, neighbors } = generateSeatLayout({ pattern: '2+2', rows: 10, backBench: 5 });
    expect(seats).toHaveLength(45);
    const bench = seats.filter((s) => s.side === 'BENCH');
    expect(bench.map((s) => s.label)).toEqual(['11A', '11B', '11C', '11D', '11E']);
    expect(bench.every((s) => s.rowIndex === 10)).toBe(true);
    expect(neighborsOf('11A', neighbors)).toEqual(['11B']);
    expect(neighborsOf('11C', neighbors)).toEqual(['11B', '11D']);
    expect(neighborsOf('11E', neighbors)).toEqual(['11D']);
    // 10 Reihen mal 2 Paare plus 4 Kettenglieder.
    expect(neighbors).toHaveLength(24);
  });

  it('Labels sind eindeutig, alle Sitze verkäuflich, Paare nur zwischen vorhandenen Sitzen', () => {
    const { seats, neighbors } = generateSeatLayout({ pattern: '2+2', rows: 10, backBench: 5 });
    const labels = new Set(seats.map((s) => s.label));
    expect(labels.size).toBe(seats.length);
    expect(seats.every((s) => s.isSellable)).toBe(true);
    for (const [a, b] of neighbors) {
      expect(labels.has(a)).toBe(true);
      expect(labels.has(b)).toBe(true);
      expect(a).not.toBe(b);
    }
  });

  it('Paare kommen genau einmal vor (a vor b in Sitzreihenfolge)', () => {
    const { seats, neighbors } = generateSeatLayout({ pattern: '2+2', rows: 3, backBench: 5 });
    const order = new Map(seats.map((s, i) => [s.label, i]));
    const keys = neighbors.map(([a, b]) => `${a}|${b}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const [a, b] of neighbors) {
      expect(order.get(a)!).toBeLessThan(order.get(b)!);
    }
  });

  it('lehnt ungültige Eingaben ab', () => {
    expect(() => generateSeatLayout({ pattern: '2+2', rows: 0 })).toThrow();
    expect(() => generateSeatLayout({ pattern: '2+2', rows: 1.5 })).toThrow();
    expect(() => generateSeatLayout({ pattern: '2+2', rows: 51 })).toThrow();
    expect(() => generateSeatLayout({ pattern: '2+2', rows: 5, backBench: 1 })).toThrow();
    expect(() => generateSeatLayout({ pattern: '2+2', rows: 5, backBench: 9 })).toThrow();
  });
});
