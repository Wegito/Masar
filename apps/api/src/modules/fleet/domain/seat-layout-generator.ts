/** Erzeugt Standard-Sitzpläne samt Nachbarpaaren (ADR 0006). Reine Funktion ohne Ein- und Ausgabe. */

export type SeatSide = 'LEFT' | 'RIGHT' | 'BENCH';

export interface GeneratedSeat {
  label: string;
  rowIndex: number;
  colIndex: number;
  side: SeatSide;
  isSellable: boolean;
}

export interface SeatLayoutSpec {
  pattern: '2+2' | '2+1';
  /** Reguläre Reihen, 1 bis 50. */
  rows: number;
  /** Sitze der Hinterbank, 2 bis 8; ohne Angabe gibt es keine Hinterbank. */
  backBench?: number;
}

export interface GeneratedLayout {
  seats: GeneratedSeat[];
  /** Ungerichtete Paare, je Paar einmal, der frühere Sitz zuerst. Die Datenbank speichert beide Richtungen. */
  neighbors: [string, string][];
}

const LETTERS = 'ABCDEFGH';
const MAX_ROWS = 50;
const MIN_BENCH = 2;
const MAX_BENCH = 8;

/** Sitze je Seite einer Reihe: Anzahl links und rechts vom Gang. */
const PATTERN_SIDES: Record<SeatLayoutSpec['pattern'], { left: number; right: number }> = {
  '2+2': { left: 2, right: 2 },
  '2+1': { left: 2, right: 1 },
};

function assertInteger(value: number, min: number, max: number, name: string): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} muss eine ganze Zahl von ${min} bis ${max} sein.`);
  }
}

export function generateSeatLayout(spec: SeatLayoutSpec): GeneratedLayout {
  assertInteger(spec.rows, 1, MAX_ROWS, 'rows');
  if (spec.backBench !== undefined) {
    assertInteger(spec.backBench, MIN_BENCH, MAX_BENCH, 'backBench');
  }

  const { left, right } = PATTERN_SIDES[spec.pattern];
  const seats: GeneratedSeat[] = [];
  const neighbors: [string, string][] = [];

  for (let row = 0; row < spec.rows; row++) {
    const labels: string[] = [];
    for (let col = 0; col < left + right; col++) {
      const label = `${row + 1}${LETTERS[col]}`;
      labels.push(label);
      seats.push({
        label,
        rowIndex: row,
        colIndex: col,
        side: col < left ? 'LEFT' : 'RIGHT',
        isSellable: true,
      });
    }
    // Nachbarn sind unmittelbar benachbarte Sitze derselben Gangseite.
    for (let col = 1; col < labels.length; col++) {
      if (col < left === col - 1 < left) {
        neighbors.push([labels[col - 1]!, labels[col]!]);
      }
    }
  }

  if (spec.backBench !== undefined) {
    const labels: string[] = [];
    for (let col = 0; col < spec.backBench; col++) {
      const label = `${spec.rows + 1}${LETTERS[col]}`;
      labels.push(label);
      seats.push({ label, rowIndex: spec.rows, colIndex: col, side: 'BENCH', isSellable: true });
    }
    // Die Hinterbank ist eine Kette, der mittlere Sitz hat zwei Nachbarn.
    for (let col = 1; col < labels.length; col++) {
      neighbors.push([labels[col - 1]!, labels[col]!]);
    }
  }

  return { seats, neighbors };
}
