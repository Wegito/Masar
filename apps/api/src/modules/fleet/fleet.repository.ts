import { Injectable } from '@nestjs/common';

import type {
  BusStatus,
  Prisma,
  SeatLayoutPattern,
  SeatLayoutStatus,
  SeatSide,
} from '../../generated/prisma/client.js';
import { directedNeighbors } from './domain/layout-rules.js';
import type { GeneratedLayout } from './domain/seat-layout-generator.js';

/** Datenbankzugriff der Flotte. Jede Abfrage nennt die Firma, damit kein Pfad sie vergisst. */
type Db = Prisma.TransactionClient;

export interface LayoutSummaryRow {
  id: string;
  name: string;
  version: number;
  pattern: SeatLayoutPattern;
  status: SeatLayoutStatus;
  supersedesLayoutId: string | null;
  createdAt: Date;
  updatedAt: Date;
  seatCount: number;
  tripCount: number;
  busCount: number;
}

export interface SeatRow {
  id: string;
  label: string;
  rowIndex: number;
  colIndex: number;
  side: SeatSide;
  isSellable: boolean;
}

export interface LayoutDetailRow extends LayoutSummaryRow {
  seats: SeatRow[];
  /** Nachbarpaare als Sitz-IDs, jede Richtung einzeln wie gespeichert. */
  neighbors: { seatId: string; neighborSeatId: string }[];
}

export interface LockedLayout {
  id: string;
  name: string;
  version: number;
  status: SeatLayoutStatus;
}

export interface BusRow {
  id: string;
  plate: string;
  status: BusStatus;
  createdAt: Date;
  updatedAt: Date;
  seatLayout: {
    id: string;
    name: string;
    version: number;
    status: SeatLayoutStatus;
    seatCount: number;
  };
  tripCount: number;
}

export interface LockedBus {
  id: string;
  plate: string;
  status: BusStatus;
  seatLayoutId: string;
}

const LAYOUT_SUMMARY_SELECT = {
  id: true,
  name: true,
  version: true,
  pattern: true,
  status: true,
  supersedesLayoutId: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { seats: true, trips: true, buses: true } },
} as const satisfies Prisma.SeatLayoutSelect;

type LayoutSummarySelected = Prisma.SeatLayoutGetPayload<{ select: typeof LAYOUT_SUMMARY_SELECT }>;

function toSummary(row: LayoutSummarySelected): LayoutSummaryRow {
  const { _count, ...rest } = row;
  return {
    ...rest,
    seatCount: _count.seats,
    tripCount: _count.trips,
    busCount: _count.buses,
  };
}

const BUS_SELECT = {
  id: true,
  plate: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  seatLayout: {
    select: {
      id: true,
      name: true,
      version: true,
      status: true,
      _count: { select: { seats: true } },
    },
  },
  _count: { select: { trips: true } },
} as const satisfies Prisma.BusSelect;

type BusSelected = Prisma.BusGetPayload<{ select: typeof BUS_SELECT }>;

function toBus(row: BusSelected): BusRow {
  const { _count, seatLayout, ...rest } = row;
  const { _count: layoutCount, ...layout } = seatLayout;
  return {
    ...rest,
    seatLayout: { ...layout, seatCount: layoutCount.seats },
    tripCount: _count.trips,
  };
}

@Injectable()
export class FleetRepository {
  // --- Sitzpläne -----------------------------------------------------------------------------

  async listLayouts(
    db: Db,
    companyId: string,
    status: SeatLayoutStatus | undefined,
  ): Promise<LayoutSummaryRow[]> {
    const rows = await db.seatLayout.findMany({
      where: { companyId, ...(status === undefined ? {} : { status }) },
      select: LAYOUT_SUMMARY_SELECT,
      orderBy: [{ name: 'asc' }, { version: 'desc' }],
    });
    return rows.map(toSummary);
  }

  async findLayout(db: Db, companyId: string, layoutId: string): Promise<LayoutDetailRow | null> {
    const row = await db.seatLayout.findFirst({
      where: { id: layoutId, companyId },
      select: {
        ...LAYOUT_SUMMARY_SELECT,
        seats: {
          select: {
            id: true,
            label: true,
            rowIndex: true,
            colIndex: true,
            side: true,
            isSellable: true,
          },
          orderBy: [{ rowIndex: 'asc' }, { colIndex: 'asc' }],
        },
        neighbors: { select: { seatId: true, neighborSeatId: true } },
      },
    });
    if (row === null) return null;
    const { seats, neighbors, ...summary } = row;
    return { ...toSummary(summary), seats, neighbors };
  }

  /**
   * Sperrt die Sitzplan-Zeile (`FOR UPDATE`). Eine gleichzeitig angelegte Fahrt hält über ihren
   * Fremdschlüssel `FOR KEY SHARE` auf derselben Zeile; damit sieht die Prüfung „von einer Fahrt
   * genutzt" nach der Sperre jede bereits bestätigte Fahrt, und eine spätere wartet.
   */
  async lockLayout(db: Db, companyId: string, layoutId: string): Promise<LockedLayout | null> {
    const rows = await db.$queryRaw<LockedLayout[]>`
      SELECT id, name, version, status
      FROM seat_layout
      WHERE id = ${layoutId}::uuid AND company_id = ${companyId}::uuid
      FOR UPDATE`;
    return rows[0] ?? null;
  }

  async countTripsForLayout(db: Db, layoutId: string): Promise<number> {
    return db.trip.count({ where: { seatLayoutId: layoutId } });
  }

  /**
   * Versionen eines Namens, gesperrt: Zwei gleichzeitige neue Versionen desselben Plans warten
   * aufeinander, statt dieselbe Nummer zu vergeben.
   */
  async lockLayoutVersions(db: Db, companyId: string, name: string): Promise<number[]> {
    const rows = await db.$queryRaw<{ version: number }[]>`
      SELECT version
      FROM seat_layout
      WHERE company_id = ${companyId}::uuid AND name = ${name}
      FOR UPDATE`;
    return rows.map((row) => row.version);
  }

  async layoutNameExists(
    db: Db,
    companyId: string,
    name: string,
    exceptId?: string,
  ): Promise<boolean> {
    const row = await db.seatLayout.findFirst({
      where: { companyId, name, ...(exceptId === undefined ? {} : { id: { not: exceptId } }) },
      select: { id: true },
    });
    return row !== null;
  }

  async insertLayout(
    db: Db,
    data: {
      companyId: string;
      name: string;
      version: number;
      pattern: SeatLayoutPattern;
      supersedesLayoutId?: string;
    },
    generated: GeneratedLayout,
  ): Promise<string> {
    const layout = await db.seatLayout.create({
      data: { ...data, status: 'ACTIVE' },
      select: { id: true },
    });
    await this.insertSeats(db, layout.id, generated);
    return layout.id;
  }

  /** Ersetzt Sitze und Nachbarpaare eines (gesperrten, unbenutzten) Sitzplans. */
  async replaceSeats(
    db: Db,
    layoutId: string,
    data: { name: string; pattern: SeatLayoutPattern },
    generated: GeneratedLayout,
  ): Promise<void> {
    // Nachbarpaare hängen per ON DELETE CASCADE an den Sitzen. Ein Kontingent (trip_seat) würde
    // das Löschen mit ON DELETE RESTRICT verhindern; es kann ohne Fahrt nicht existieren.
    await db.seat.deleteMany({ where: { layoutId } });
    await db.seatLayout.update({ where: { id: layoutId }, data });
    await this.insertSeats(db, layoutId, generated);
  }

  async retireLayout(db: Db, layoutId: string): Promise<void> {
    await db.seatLayout.update({ where: { id: layoutId }, data: { status: 'RETIRED' } });
  }

  private async insertSeats(db: Db, layoutId: string, generated: GeneratedLayout): Promise<void> {
    const seats = await db.seat.createManyAndReturn({
      data: generated.seats.map((seat) => ({ layoutId, ...seat })),
      select: { id: true, label: true },
    });
    const seatIdByLabel = new Map(seats.map((seat) => [seat.label, seat.id]));
    const pairs = directedNeighbors(generated.neighbors, seatIdByLabel);
    if (pairs.length > 0) {
      await db.seatNeighbor.createMany({
        data: pairs.map((pair) => ({ layoutId, ...pair })),
      });
    }
  }

  // --- Busse ---------------------------------------------------------------------------------

  async listBuses(db: Db, companyId: string): Promise<BusRow[]> {
    const rows = await db.bus.findMany({
      where: { companyId },
      select: BUS_SELECT,
      orderBy: [{ status: 'asc' }, { plate: 'asc' }],
    });
    return rows.map(toBus);
  }

  async findBus(db: Db, companyId: string, busId: string): Promise<BusRow | null> {
    const row = await db.bus.findFirst({ where: { id: busId, companyId }, select: BUS_SELECT });
    return row === null ? null : toBus(row);
  }

  /** Sperrt die Bus-Zeile; eine gleichzeitig angelegte Fahrt wartet über ihren Fremdschlüssel. */
  async lockBus(db: Db, companyId: string, busId: string): Promise<LockedBus | null> {
    const rows = await db.$queryRaw<LockedBus[]>`
      SELECT id, plate, status, seat_layout_id AS "seatLayoutId"
      FROM bus
      WHERE id = ${busId}::uuid AND company_id = ${companyId}::uuid
      FOR UPDATE`;
    return rows[0] ?? null;
  }

  async countTripsForBus(db: Db, busId: string): Promise<number> {
    return db.trip.count({ where: { busId } });
  }

  /**
   * Status eines Sitzplans der Firma mit `FOR SHARE`: Ein gleichzeitiges Archivieren wartet, bis
   * der Bus zugeordnet ist, statt ihn an einen soeben archivierten Plan zu hängen. Sperrfolge
   * immer Bus vor Sitzplan.
   */
  async shareLockLayoutStatus(
    db: Db,
    companyId: string,
    layoutId: string,
  ): Promise<SeatLayoutStatus | null> {
    const rows = await db.$queryRaw<{ status: SeatLayoutStatus }[]>`
      SELECT status
      FROM seat_layout
      WHERE id = ${layoutId}::uuid AND company_id = ${companyId}::uuid
      FOR SHARE`;
    return rows[0]?.status ?? null;
  }

  async plateExists(db: Db, companyId: string, plate: string, exceptId?: string): Promise<boolean> {
    const row = await db.bus.findFirst({
      where: { companyId, plate, ...(exceptId === undefined ? {} : { id: { not: exceptId } }) },
      select: { id: true },
    });
    return row !== null;
  }

  async insertBus(
    db: Db,
    data: { companyId: string; plate: string; seatLayoutId: string },
  ): Promise<string> {
    const bus = await db.bus.create({ data, select: { id: true } });
    return bus.id;
  }

  async updateBus(
    db: Db,
    busId: string,
    data: { plate?: string; seatLayoutId?: string; status?: BusStatus },
  ): Promise<void> {
    await db.bus.update({ where: { id: busId }, data });
  }
}
