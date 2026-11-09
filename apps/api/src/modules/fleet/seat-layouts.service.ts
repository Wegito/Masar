import type { GeneratedSeatLayoutPattern } from '@masar/shared';
import { Injectable } from '@nestjs/common';

import { AppError } from '../../common/app-error.js';
import type { RequestContext } from '../../common/request-context.js';
import type { Prisma, SeatLayoutPattern, SeatSide } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import {
  generatorSpec,
  layoutDimensions,
  layoutEditBlocker,
  nextLayoutVersion,
} from './domain/layout-rules.js';
import { type GeneratedLayout, generateSeatLayout } from './domain/seat-layout-generator.js';
import { isUniqueViolation, mapFleetError } from './fleet-errors.js';
import type { CreateLayoutInput, LayoutSpecInput, ListLayoutsQuery } from './fleet.schemas.js';
import {
  FleetRepository,
  type LayoutDetailRow,
  type LayoutSummaryRow,
} from './fleet.repository.js';

export interface LayoutSummaryView {
  id: string;
  name: string;
  version: number;
  pattern: SeatLayoutPattern;
  status: LayoutSummaryRow['status'];
  supersedesLayoutId: string | null;
  seatCount: number;
  tripCount: number;
  busCount: number;
  /** An Ort und Stelle änderbar (unbenutzt, nicht archiviert); sonst nur neue Version. */
  editable: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface LayoutSeatView {
  label: string;
  row: number;
  column: number;
  side: SeatSide;
}

export interface LayoutDetailView extends LayoutSummaryView {
  layout: { rows: number; columns: number };
  seats: (LayoutSeatView & { id: string; isSellable: boolean })[];
  /** Ungerichtete Nachbarpaare als Beschriftungen (ADR 0006). */
  neighbors: [string, string][];
}

export interface LayoutPreviewView {
  pattern: GeneratedSeatLayoutPattern;
  layout: { rows: number; columns: number };
  seatCount: number;
  seats: LayoutSeatView[];
  neighbors: [string, string][];
}

const TX = { maxWait: 5_000, timeout: 15_000 } as const;

function generate(spec: LayoutSpecInput): GeneratedLayout {
  return generateSeatLayout(generatorSpec(spec));
}

function toSummaryView(row: LayoutSummaryRow): LayoutSummaryView {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    pattern: row.pattern,
    status: row.status,
    supersedesLayoutId: row.supersedesLayoutId,
    seatCount: row.seatCount,
    tripCount: row.tripCount,
    busCount: row.busCount,
    editable: layoutEditBlocker({ status: row.status, tripCount: row.tripCount }) === null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toDetailView(row: LayoutDetailRow): LayoutDetailView {
  const labelById = new Map(row.seats.map((seat) => [seat.id, seat.label]));
  const neighbors: [string, string][] = [];
  for (const pair of row.neighbors) {
    const a = labelById.get(pair.seatId);
    const b = labelById.get(pair.neighborSeatId);
    // Jede Richtung steht einzeln in der Tabelle; die Antwort nennt jedes Paar einmal.
    if (a !== undefined && b !== undefined && pair.seatId < pair.neighborSeatId) {
      neighbors.push([a, b]);
    }
  }
  neighbors.sort((x, y) => x[0].localeCompare(y[0], 'en', { numeric: true }));
  return {
    ...toSummaryView(row),
    layout: layoutDimensions(row.seats),
    seats: row.seats.map((seat) => ({
      id: seat.id,
      label: seat.label,
      row: seat.rowIndex,
      column: seat.colIndex,
      side: seat.side,
      isSellable: seat.isSellable,
    })),
    neighbors,
  };
}

/**
 * Sitzpläne einer Firma (Schritt 2.2, ADR 0024). Die Firma kommt nur aus dem geprüften Pfad.
 * Ein Sitzplan entsteht aus dem Generator; solange keine Fahrt ihn nutzt, darf er neu erzeugt
 * werden, danach nur eine neue Version oder Archivieren.
 */
@Injectable()
export class SeatLayoutsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: FleetRepository,
    private readonly audit: AuditService,
  ) {}

  async list(companyId: string, query: ListLayoutsQuery): Promise<{ items: LayoutSummaryView[] }> {
    const rows = await this.repo.listLayouts(this.prisma, companyId, query.status);
    return { items: rows.map(toSummaryView) };
  }

  async get(companyId: string, layoutId: string): Promise<LayoutDetailView> {
    const row = await this.repo.findLayout(this.prisma, companyId, layoutId);
    if (row === null) {
      throw new AppError('SEAT_LAYOUT_NOT_FOUND');
    }
    return toDetailView(row);
  }

  /** Vorschau ohne Speichern; dieselbe Funktion wie beim Anlegen. */
  preview(spec: LayoutSpecInput): LayoutPreviewView {
    const generated = generate(spec);
    return {
      pattern: spec.pattern,
      layout: layoutDimensions(generated.seats),
      seatCount: generated.seats.length,
      seats: generated.seats.map((seat) => ({
        label: seat.label,
        row: seat.rowIndex,
        column: seat.colIndex,
        side: seat.side,
      })),
      neighbors: generated.neighbors,
    };
  }

  async create(
    companyId: string,
    input: CreateLayoutInput,
    actor: AuthContext,
    context: RequestContext,
  ): Promise<LayoutDetailView> {
    const generated = generate(input);
    const layoutId = await this.run(async (tx) => {
      // Ein Name gehört zu einer Versionsreihe; ein neuer Plan unter altem Namen ist eine Version.
      if (await this.repo.layoutNameExists(tx, companyId, input.name)) {
        throw new AppError('SEAT_LAYOUT_NAME_TAKEN');
      }
      const id = await this.repo.insertLayout(
        tx,
        { companyId, name: input.name, version: 1, pattern: input.pattern },
        generated,
      );
      await this.record(tx, 'SEAT_LAYOUT_CREATED', companyId, id, actor, context, {
        pattern: input.pattern,
        seatCount: generated.seats.length,
      });
      return id;
    });
    return this.get(companyId, layoutId);
  }

  /** Erzeugt Sitze und Nachbarn neu und benennt um, solange keine Fahrt den Plan nutzt. */
  async regenerate(
    companyId: string,
    layoutId: string,
    input: CreateLayoutInput,
    actor: AuthContext,
    context: RequestContext,
  ): Promise<LayoutDetailView> {
    const generated = generate(input);
    await this.run(async (tx) => {
      const locked = await this.repo.lockLayout(tx, companyId, layoutId);
      if (locked === null) {
        throw new AppError('SEAT_LAYOUT_NOT_FOUND');
      }
      const tripCount = await this.repo.countTripsForLayout(tx, layoutId);
      const blocker = layoutEditBlocker({ status: locked.status, tripCount });
      if (blocker !== null) {
        throw new AppError(blocker);
      }
      if (
        input.name !== locked.name &&
        (await this.repo.layoutNameExists(tx, companyId, input.name, layoutId))
      ) {
        throw new AppError('SEAT_LAYOUT_NAME_TAKEN');
      }
      await this.repo.replaceSeats(
        tx,
        layoutId,
        { name: input.name, pattern: input.pattern },
        generated,
      );
      await this.record(tx, 'SEAT_LAYOUT_REGENERATED', companyId, layoutId, actor, context, {
        pattern: input.pattern,
        seatCount: generated.seats.length,
      });
    });
    return this.get(companyId, layoutId);
  }

  /** Neue Version unter demselben Namen; der Vorgänger bleibt unverändert und nutzbar. */
  async createVersion(
    companyId: string,
    layoutId: string,
    spec: LayoutSpecInput,
    actor: AuthContext,
    context: RequestContext,
  ): Promise<LayoutDetailView> {
    const generated = generate(spec);
    const newId = await this.run(async (tx) => {
      const source = await this.repo.lockLayout(tx, companyId, layoutId);
      if (source === null) {
        throw new AppError('SEAT_LAYOUT_NOT_FOUND');
      }
      const versions = await this.repo.lockLayoutVersions(tx, companyId, source.name);
      const id = await this.repo.insertLayout(
        tx,
        {
          companyId,
          name: source.name,
          version: nextLayoutVersion(versions),
          pattern: spec.pattern,
          supersedesLayoutId: source.id,
        },
        generated,
      );
      await this.record(tx, 'SEAT_LAYOUT_VERSION_CREATED', companyId, id, actor, context, {
        supersedesLayoutId: source.id,
        pattern: spec.pattern,
        seatCount: generated.seats.length,
      });
      return id;
    });
    return this.get(companyId, newId);
  }

  /** Archiviert den Plan; bestehende Fahrten und Busse behalten ihn. Wiederholung ändert nichts. */
  async retire(
    companyId: string,
    layoutId: string,
    actor: AuthContext,
    context: RequestContext,
  ): Promise<LayoutDetailView> {
    await this.run(async (tx) => {
      const locked = await this.repo.lockLayout(tx, companyId, layoutId);
      if (locked === null) {
        throw new AppError('SEAT_LAYOUT_NOT_FOUND');
      }
      if (locked.status === 'RETIRED') {
        return;
      }
      await this.repo.retireLayout(tx, layoutId);
      await this.record(tx, 'SEAT_LAYOUT_RETIRED', companyId, layoutId, actor, context, {
        previousStatus: locked.status,
      });
    });
    return this.get(companyId, layoutId);
  }

  private async run<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(work, TX);
    } catch (error) {
      // Zwei gleichzeitige Pläne mit demselben Namen: Der eindeutige Index entscheidet.
      if (isUniqueViolation(error)) {
        throw new AppError('SEAT_LAYOUT_NAME_TAKEN');
      }
      throw mapFleetError(error);
    }
  }

  private async record(
    tx: Prisma.TransactionClient,
    action: string,
    companyId: string,
    layoutId: string,
    actor: AuthContext,
    context: RequestContext,
    data: Prisma.InputJsonObject,
  ): Promise<void> {
    await this.audit.record(
      {
        action,
        actorType: 'USER',
        actorId: actor.userId,
        companyId,
        entityType: 'seat_layout',
        entityId: layoutId,
        data,
      },
      context,
      tx,
    );
  }
}
