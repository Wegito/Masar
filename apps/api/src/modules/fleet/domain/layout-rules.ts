import type { ErrorCode, GeneratedSeatLayoutPattern, SeatLayoutStatus } from '@masar/shared';

import type { SeatLayoutSpec } from './seat-layout-generator.js';

/**
 * Regeln für Sitzpläne und Busse (Schritt 2.2, ADR 0024). Reine Funktionen: Der Service liest den
 * Zustand unter Sperre und fragt hier, ob die Änderung erlaubt ist.
 */

const GENERATOR_PATTERN: Record<GeneratedSeatLayoutPattern, SeatLayoutSpec['pattern']> = {
  TWO_PLUS_TWO: '2+2',
  TWO_PLUS_ONE: '2+1',
};

/** Übersetzt das API-Muster in die Schreibweise des Generators. */
export function generatorSpec(input: {
  pattern: GeneratedSeatLayoutPattern;
  rows: number;
  backBench?: number | undefined;
}): SeatLayoutSpec {
  return {
    pattern: GENERATOR_PATTERN[input.pattern],
    rows: input.rows,
    ...(input.backBench === undefined ? {} : { backBench: input.backBench }),
  };
}

/** Ausdehnung eines Sitzplans für die Darstellung: Zahl der Reihen und Spalten. */
export function layoutDimensions(seats: readonly { rowIndex: number; colIndex: number }[]): {
  rows: number;
  columns: number;
} {
  let rows = 0;
  let columns = 0;
  for (const seat of seats) {
    rows = Math.max(rows, seat.rowIndex + 1);
    columns = Math.max(columns, seat.colIndex + 1);
  }
  return { rows, columns };
}

/**
 * Darf der Sitzplan an Ort und Stelle neu erzeugt oder umbenannt werden? Nur, solange keine Fahrt
 * ihn nutzt (ADR 0005: Der Sitzplan einer Fahrt ist eingefroren) und er nicht archiviert ist.
 * Sonst ist der Weg eine neue Version.
 */
export function layoutEditBlocker(state: {
  status: SeatLayoutStatus;
  tripCount: number;
}): ErrorCode | null {
  if (state.status === 'RETIRED') return 'SEAT_LAYOUT_RETIRED';
  if (state.tripCount > 0) return 'SEAT_LAYOUT_IN_USE';
  return null;
}

/** Ein archivierter Sitzplan nimmt keine neuen Busse mehr an. */
export function layoutAssignBlocker(status: SeatLayoutStatus): ErrorCode | null {
  return status === 'RETIRED' ? 'SEAT_LAYOUT_RETIRED' : null;
}

/**
 * Darf ein Bus den Sitzplan wechseln? Nur ohne Fahrten: Der Fremdschlüssel der Fahrt auf den Bus
 * schließt den Sitzplan ein (ADR 0018, `ON UPDATE CASCADE`) und würde die Änderung sonst still auf
 * bestehende Fahrten übertragen.
 */
export function busLayoutChangeBlocker(state: {
  currentLayoutId: string;
  newLayoutId: string;
  tripCount: number;
}): ErrorCode | null {
  if (state.currentLayoutId === state.newLayoutId) return null;
  return state.tripCount > 0 ? 'BUS_IN_USE' : null;
}

/** Nächste Versionsnummer eines Sitzplannamens. */
export function nextLayoutVersion(existing: readonly number[]): number {
  return existing.reduce((max, version) => Math.max(max, version), 0) + 1;
}

/**
 * Nachbarpaare in beiden Richtungen, wie `seat_neighbor` sie speichert (ADR 0006). Ein Paar mit
 * unbekannter Beschriftung ist ein Fehler im Generator und bricht ab.
 */
export function directedNeighbors(
  pairs: readonly (readonly [string, string])[],
  seatIdByLabel: ReadonlyMap<string, string>,
): { seatId: string; neighborSeatId: string }[] {
  return pairs.flatMap(([a, b]) => {
    const first = seatIdByLabel.get(a);
    const second = seatIdByLabel.get(b);
    if (first === undefined || second === undefined) {
      throw new Error('Nachbarpaar verweist auf einen unbekannten Sitz.');
    }
    return [
      { seatId: first, neighborSeatId: second },
      { seatId: second, neighborSeatId: first },
    ];
  });
}
