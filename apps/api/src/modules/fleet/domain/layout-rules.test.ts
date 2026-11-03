import { describe, expect, it } from 'vitest';

import {
  busLayoutChangeBlocker,
  directedNeighbors,
  generatorSpec,
  layoutAssignBlocker,
  layoutDimensions,
  layoutEditBlocker,
  nextLayoutVersion,
} from './layout-rules.js';
import { generateSeatLayout } from './seat-layout-generator.js';

describe('generatorSpec', () => {
  it('übersetzt die Muster und lässt die Hinterbank weg, wenn sie fehlt', () => {
    expect(generatorSpec({ pattern: 'TWO_PLUS_TWO', rows: 10, backBench: 5 })).toEqual({
      pattern: '2+2',
      rows: 10,
      backBench: 5,
    });
    expect(generatorSpec({ pattern: 'TWO_PLUS_ONE', rows: 8 })).toEqual({
      pattern: '2+1',
      rows: 8,
    });
  });
});

describe('layoutDimensions', () => {
  it('zählt Reihen und Spalten eines 45-Sitzers mit Hinterbank', () => {
    const { seats } = generateSeatLayout({ pattern: '2+2', rows: 10, backBench: 5 });
    expect(layoutDimensions(seats)).toEqual({ rows: 11, columns: 5 });
  });

  it('ergibt 0 × 0 ohne Sitze', () => {
    expect(layoutDimensions([])).toEqual({ rows: 0, columns: 0 });
  });
});

describe('layoutEditBlocker', () => {
  it('erlaubt Änderungen an einem unbenutzten, nicht archivierten Sitzplan', () => {
    expect(layoutEditBlocker({ status: 'ACTIVE', tripCount: 0 })).toBeNull();
    expect(layoutEditBlocker({ status: 'DRAFT', tripCount: 0 })).toBeNull();
  });

  it('sperrt Sitzpläne, die eine Fahrt nutzt', () => {
    expect(layoutEditBlocker({ status: 'ACTIVE', tripCount: 1 })).toBe('SEAT_LAYOUT_IN_USE');
  });

  it('sperrt archivierte Sitzpläne, auch unbenutzt', () => {
    expect(layoutEditBlocker({ status: 'RETIRED', tripCount: 0 })).toBe('SEAT_LAYOUT_RETIRED');
    expect(layoutEditBlocker({ status: 'RETIRED', tripCount: 3 })).toBe('SEAT_LAYOUT_RETIRED');
  });
});

describe('layoutAssignBlocker', () => {
  it('lässt nur nicht archivierte Sitzpläne zu', () => {
    expect(layoutAssignBlocker('ACTIVE')).toBeNull();
    expect(layoutAssignBlocker('RETIRED')).toBe('SEAT_LAYOUT_RETIRED');
  });
});

describe('busLayoutChangeBlocker', () => {
  it('erlaubt denselben Sitzplan immer', () => {
    expect(
      busLayoutChangeBlocker({ currentLayoutId: 'a', newLayoutId: 'a', tripCount: 4 }),
    ).toBeNull();
  });

  it('erlaubt einen Wechsel nur ohne Fahrten', () => {
    expect(
      busLayoutChangeBlocker({ currentLayoutId: 'a', newLayoutId: 'b', tripCount: 0 }),
    ).toBeNull();
    expect(busLayoutChangeBlocker({ currentLayoutId: 'a', newLayoutId: 'b', tripCount: 1 })).toBe(
      'BUS_IN_USE',
    );
  });
});

describe('nextLayoutVersion', () => {
  it('beginnt bei 1 und zählt über das Maximum hinaus', () => {
    expect(nextLayoutVersion([])).toBe(1);
    expect(nextLayoutVersion([1, 3, 2])).toBe(4);
  });
});

describe('directedNeighbors', () => {
  it('speichert jedes Paar in beiden Richtungen', () => {
    const ids = new Map([
      ['1A', 'a'],
      ['1B', 'b'],
    ]);
    expect(directedNeighbors([['1A', '1B']], ids)).toEqual([
      { seatId: 'a', neighborSeatId: 'b' },
      { seatId: 'b', neighborSeatId: 'a' },
    ]);
  });

  it('ergibt für den Generator symmetrische Paare ohne Selbstbezug', () => {
    const layout = generateSeatLayout({ pattern: '2+1', rows: 3, backBench: 4 });
    const ids = new Map(layout.seats.map((seat) => [seat.label, `id-${seat.label}`]));
    const directed = directedNeighbors(layout.neighbors, ids);
    const keys = new Set(directed.map((pair) => `${pair.seatId}>${pair.neighborSeatId}`));
    for (const pair of directed) {
      expect(pair.seatId).not.toBe(pair.neighborSeatId);
      expect(keys.has(`${pair.neighborSeatId}>${pair.seatId}`)).toBe(true);
    }
    expect(directed).toHaveLength(2 * layout.neighbors.length);
  });

  it('bricht bei unbekannten Beschriftungen ab', () => {
    expect(() => directedNeighbors([['1A', '9Z']], new Map([['1A', 'a']]))).toThrow();
  });
});
