/**
 * Sitzplan-Generator für Standardlayouts (ADR 0006, docs/domaenenmodell.md, Abschnitt Sitzpläne).
 *
 * Koordinaten beschreiben die physische Lage im Bus mit Blick in Fahrtrichtung: Spalte 0 ist die
 * linke Fensterseite (in Syrien die Fahrerseite). Ob die Oberfläche das im Arabischen spiegelt,
 * entscheidet sie selbst; die Daten bleiben physisch.
 *
 * Nachbarschaft ist ein Graph, keine Gruppe: Auf der Hinterbank hat der mittlere Sitz zwei
 * Nachbarn. Jedes Paar wird in beiden Richtungen geliefert, wie es `seat_neighbor` speichert.
 */

export const SEAT_SIDES = ['LEFT', 'AISLE', 'RIGHT'] as const;
export type SeatSide = (typeof SEAT_SIDES)[number];

/** Muster, die der Generator erzeugen kann. `CUSTOM` entsteht später im Portal-Editor. */
export const GENERATED_LAYOUT_PATTERNS = ['TWO_PLUS_TWO', 'TWO_PLUS_ONE'] as const;
export type GeneratedLayoutPattern = (typeof GENERATED_LAYOUT_PATTERNS)[number];

export const MAX_SEAT_ROWS = 20;

export interface GeneratedSeat {
  readonly label: string;
  readonly rowIndex: number;
  readonly colIndex: number;
  readonly side: SeatSide;
}

export interface SeatLayoutBlueprint {
  readonly pattern: GeneratedLayoutPattern;
  readonly seats: readonly GeneratedSeat[];
  /** Nachbarpaare über die Beschriftung, jedes Paar in beiden Richtungen. */
  readonly neighbors: readonly (readonly [string, string])[];
}

export interface SeatLayoutOptions {
  readonly pattern: GeneratedLayoutPattern;
  /** Normale Reihen vor der Hinterbank. */
  readonly rows: number;
  /** Durchgehende Hinterbank über die volle Breite, inklusive Gangplatz. */
  readonly rearBench: boolean;
}

/**
 * Spalten je Muster. Annahme bis zur ersten Partnerfirma (docs/offene-entscheidungen.md,
 * „Sitzplan-Praxis"): Bei 2+1 liegt die Doppelseite links, der Einzelsitz rechts.
 */
const GRID: Record<GeneratedLayoutPattern, { left: number[]; aisle: number; right: number[] }> = {
  TWO_PLUS_TWO: { left: [0, 1], aisle: 2, right: [3, 4] },
  TWO_PLUS_ONE: { left: [0, 1], aisle: 2, right: [3] },
};

export function generateSeatLayout(options: SeatLayoutOptions): SeatLayoutBlueprint {
  const { pattern, rows, rearBench } = options;
  if (!Number.isInteger(rows) || rows < 1 || rows > MAX_SEAT_ROWS) {
    throw new RangeError(`Reihen müssen zwischen 1 und ${MAX_SEAT_ROWS} liegen, waren ${rows}`);
  }
  const grid = GRID[pattern];
  const seats: GeneratedSeat[] = [];
  const neighbors: (readonly [string, string])[] = [];
  let next = 1;

  const addSeat = (rowIndex: number, colIndex: number, side: SeatSide): string => {
    const label = String(next++);
    seats.push({ label, rowIndex, colIndex, side });
    return label;
  };
  const link = (a: string, b: string): void => {
    neighbors.push([a, b], [b, a]);
  };
  // Direkt nebeneinander auf derselben Seite sind Nachbarn; über den Gang hinweg nicht.
  const addGroup = (rowIndex: number, cols: number[], side: SeatSide): void => {
    let previous: string | undefined;
    for (const col of cols) {
      const label = addSeat(rowIndex, col, side);
      if (previous !== undefined) {
        link(previous, label);
      }
      previous = label;
    }
  };

  for (let row = 0; row < rows; row++) {
    addGroup(row, grid.left, 'LEFT');
    addGroup(row, grid.right, 'RIGHT');
  }

  if (rearBench) {
    const lastCol = Math.max(...grid.right);
    let previous: string | undefined;
    for (let col = 0; col <= lastCol; col++) {
      const side: SeatSide = col < grid.aisle ? 'LEFT' : col === grid.aisle ? 'AISLE' : 'RIGHT';
      const label = addSeat(rows, col, side);
      if (previous !== undefined) {
        link(previous, label);
      }
      previous = label;
    }
  }

  return { pattern, seats, neighbors };
}
