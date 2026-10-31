import type { Prisma } from '../../generated/prisma/client.js';
import type { SeatLayoutBlueprint } from './domain/seat-layout.js';

export interface StoredSeat {
  readonly id: string;
  readonly label: string;
  readonly isSellable: boolean;
}

export interface NewSeatLayout {
  readonly companyId: string;
  readonly name: string;
  readonly version?: number;
  readonly blueprint: SeatLayoutBlueprint;
  /** Sitze, die grundsätzlich nicht verkauft werden (z. B. Platz der Begleitperson). */
  readonly unsellableLabels?: readonly string[];
}

/**
 * Legt Sitzplan, Sitze und Nachbarpaare an. Läuft in der Transaktion des Aufrufers, damit nie ein
 * Sitzplan ohne Nachbarpaare entsteht; die Geschlechtsregel würde dort sonst nicht greifen.
 */
export async function insertSeatLayout(
  tx: Prisma.TransactionClient,
  input: NewSeatLayout,
): Promise<{ layoutId: string; seats: StoredSeat[] }> {
  const unsellable = new Set(input.unsellableLabels ?? []);
  const layout = await tx.seatLayout.create({
    data: {
      companyId: input.companyId,
      name: input.name,
      version: input.version ?? 1,
      pattern: input.blueprint.pattern,
    },
    select: { id: true },
  });
  const seats = await tx.seat.createManyAndReturn({
    data: input.blueprint.seats.map((seat) => ({
      layoutId: layout.id,
      label: seat.label,
      rowIndex: seat.rowIndex,
      colIndex: seat.colIndex,
      side: seat.side,
      isSellable: !unsellable.has(seat.label),
    })),
    select: { id: true, label: true, isSellable: true },
  });
  const idByLabel = new Map(seats.map((seat) => [seat.label, seat.id]));
  const seatId = (label: string): string => {
    const id = idByLabel.get(label);
    if (id === undefined) {
      throw new Error(`Nachbarpaar verweist auf unbekannten Sitz ${label}`);
    }
    return id;
  };
  await tx.seatNeighbor.createMany({
    data: input.blueprint.neighbors.map(([a, b]) => ({
      layoutId: layout.id,
      seatId: seatId(a),
      neighborSeatId: seatId(b),
    })),
  });
  return { layoutId: layout.id, seats };
}
