import type {
  BusStatus,
  CompanyRole,
  SeatLayoutPattern,
  SeatLayoutStatus,
  SeatSide,
} from '@masar/shared';

/** Antworten der Flotten-API (docs/api-konventionen.md, Abschnitt Flotte). */

export interface LayoutSeat {
  label: string;
  row: number;
  column: number;
  side: SeatSide;
}

export interface LayoutPreview {
  pattern: SeatLayoutPattern;
  layout: { rows: number; columns: number };
  seatCount: number;
  seats: LayoutSeat[];
  neighbors: [string, string][];
}

export interface LayoutSummary {
  id: string;
  name: string;
  version: number;
  pattern: SeatLayoutPattern;
  status: SeatLayoutStatus;
  supersedesLayoutId: string | null;
  seatCount: number;
  tripCount: number;
  busCount: number;
  editable: boolean;
  createdAt: string;
}

export interface LayoutDetail extends LayoutSummary {
  layout: { rows: number; columns: number };
  seats: (LayoutSeat & { id: string; isSellable: boolean })[];
  neighbors: [string, string][];
}

export interface Bus {
  id: string;
  plate: string;
  status: BusStatus;
  seatLayout: {
    id: string;
    name: string;
    version: number;
    status: SeatLayoutStatus;
    seatCount: number;
  };
  tripCount: number;
}

/** Schreiben dürfen nur Firmen-Admins (wie `FLEET_WRITE_ROLES` in der API). */
export function canManageFleet(role: CompanyRole): boolean {
  return role === 'ADMIN';
}

export interface SeatCell {
  label: string;
  /** Spalte im Raster ab 1; der Gang ist eine eigene, leere Spalte. */
  gridColumn: number;
  gridRow: number;
  side: SeatSide;
}

export interface SeatGrid {
  columns: number;
  rows: number;
  /** Spalte des Gangs ab 1, `null` ohne Gang (nur Hinterbank). */
  aisleColumn: number | null;
  cells: SeatCell[];
}

/**
 * Ordnet die Sitze in ein Raster mit Gang: links die Sitze der linken Seite, dann eine leere
 * Gangspalte, dann die rechte Seite. Die Hinterbank läuft über die volle Breite. Wie in der
 * Fahrgast-App (`apps/web/src/lib/seat-layout.ts`) ist das ein Grundriss: Die Darstellung setzt
 * `dir="ltr"`, damit links auch auf Arabisch links bleibt.
 */
export function seatGrid(seats: readonly LayoutSeat[]): SeatGrid {
  let left = 0;
  let right = 0;
  let bench = 0;
  let rows = 0;
  for (const seat of seats) {
    rows = Math.max(rows, seat.row + 1);
    if (seat.side === 'LEFT') left = Math.max(left, seat.column + 1);
    if (seat.side === 'BENCH') bench = Math.max(bench, seat.column + 1);
  }
  for (const seat of seats) {
    if (seat.side === 'RIGHT') right = Math.max(right, seat.column + 1 - left);
  }
  const hasAisle = left > 0 || right > 0;
  const aisleColumn = hasAisle ? left + 1 : null;
  const columns = Math.max(hasAisle ? left + right + 1 : 0, bench);
  const cells = seats.map((seat) => ({
    label: seat.label,
    side: seat.side,
    gridRow: seat.row + 1,
    gridColumn: seat.side === 'RIGHT' ? seat.column + 2 : seat.column + 1,
  }));
  return { columns, rows, aisleColumn, cells };
}
