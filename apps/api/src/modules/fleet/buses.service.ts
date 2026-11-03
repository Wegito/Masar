import { Injectable } from '@nestjs/common';

import { AppError } from '../../common/app-error.js';
import type { RequestContext } from '../../common/request-context.js';
import type { BusStatus, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { busLayoutChangeBlocker, layoutAssignBlocker } from './domain/layout-rules.js';
import { isUniqueViolation, mapFleetError } from './fleet-errors.js';
import type { CreateBusInput, UpdateBusInput } from './fleet.schemas.js';
import { type BusRow, FleetRepository } from './fleet.repository.js';

export interface BusView {
  id: string;
  plate: string;
  status: BusStatus;
  seatLayout: BusRow['seatLayout'];
  tripCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const TX = { maxWait: 5_000, timeout: 15_000 } as const;

function toView(row: BusRow): BusView {
  return {
    id: row.id,
    plate: row.plate,
    status: row.status,
    seatLayout: row.seatLayout,
    tripCount: row.tripCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Busse einer Firma (Schritt 2.2, ADR 0024). Die Firma kommt nur aus dem geprüften Pfad; ein
 * Sitzplan einer anderen Firma ist hier unbekannt, und der Fremdschlüssel `bus (seat_layout_id,
 * company_id)` hielte auch einen fehlerhaften Pfad auf (ADR 0018).
 */
@Injectable()
export class BusesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: FleetRepository,
    private readonly audit: AuditService,
  ) {}

  async list(companyId: string): Promise<{ items: BusView[] }> {
    const rows = await this.repo.listBuses(this.prisma, companyId);
    return { items: rows.map(toView) };
  }

  async get(companyId: string, busId: string): Promise<BusView> {
    const row = await this.repo.findBus(this.prisma, companyId, busId);
    if (row === null) {
      throw new AppError('BUS_NOT_FOUND');
    }
    return toView(row);
  }

  async create(
    companyId: string,
    input: CreateBusInput,
    actor: AuthContext,
    context: RequestContext,
  ): Promise<BusView> {
    const busId = await this.run(async (tx) => {
      await this.assertAssignable(tx, companyId, input.seatLayoutId);
      if (await this.repo.plateExists(tx, companyId, input.plate)) {
        throw new AppError('BUS_PLATE_TAKEN');
      }
      const id = await this.repo.insertBus(tx, { companyId, ...input });
      await this.record(tx, 'BUS_CREATED', companyId, id, actor, context, {
        seatLayoutId: input.seatLayoutId,
      });
      return id;
    });
    return this.get(companyId, busId);
  }

  /** Kennzeichen oder Sitzplan ändern. Den Sitzplan nur, solange keine Fahrt den Bus nutzt. */
  async update(
    companyId: string,
    busId: string,
    input: UpdateBusInput,
    actor: AuthContext,
    context: RequestContext,
  ): Promise<BusView> {
    await this.run(async (tx) => {
      const bus = await this.repo.lockBus(tx, companyId, busId);
      if (bus === null) {
        throw new AppError('BUS_NOT_FOUND');
      }
      const data: { plate?: string; seatLayoutId?: string } = {};
      if (input.seatLayoutId !== undefined && input.seatLayoutId !== bus.seatLayoutId) {
        await this.assertAssignable(tx, companyId, input.seatLayoutId);
        const blocker = busLayoutChangeBlocker({
          currentLayoutId: bus.seatLayoutId,
          newLayoutId: input.seatLayoutId,
          tripCount: await this.repo.countTripsForBus(tx, busId),
        });
        if (blocker !== null) {
          throw new AppError(blocker);
        }
        data.seatLayoutId = input.seatLayoutId;
      }
      if (input.plate !== undefined && input.plate !== bus.plate) {
        if (await this.repo.plateExists(tx, companyId, input.plate, busId)) {
          throw new AppError('BUS_PLATE_TAKEN');
        }
        data.plate = input.plate;
      }
      if (Object.keys(data).length === 0) {
        return;
      }
      await this.repo.updateBus(tx, busId, data);
      await this.record(tx, 'BUS_UPDATED', companyId, busId, actor, context, {
        fields: Object.keys(data),
        ...(data.seatLayoutId === undefined
          ? {}
          : { previousSeatLayoutId: bus.seatLayoutId, seatLayoutId: data.seatLayoutId }),
      });
    }, 'BUS_IN_USE');
    return this.get(companyId, busId);
  }

  /** Setzt den Status; eine Wiederholung ändert nichts und schreibt keinen Audit-Eintrag. */
  async setStatus(
    companyId: string,
    busId: string,
    status: BusStatus,
    actor: AuthContext,
    context: RequestContext,
  ): Promise<BusView> {
    await this.run(async (tx) => {
      const bus = await this.repo.lockBus(tx, companyId, busId);
      if (bus === null) {
        throw new AppError('BUS_NOT_FOUND');
      }
      if (bus.status === status) {
        return;
      }
      await this.repo.updateBus(tx, busId, { status });
      await this.record(
        tx,
        status === 'INACTIVE' ? 'BUS_DEACTIVATED' : 'BUS_ACTIVATED',
        companyId,
        busId,
        actor,
        context,
        { previousStatus: bus.status },
      );
    });
    return this.get(companyId, busId);
  }

  private async assertAssignable(
    tx: Prisma.TransactionClient,
    companyId: string,
    layoutId: string,
  ): Promise<void> {
    const status = await this.repo.shareLockLayoutStatus(tx, companyId, layoutId);
    if (status === null) {
      throw new AppError('SEAT_LAYOUT_NOT_FOUND');
    }
    const blocker = layoutAssignBlocker(status);
    if (blocker !== null) {
      throw new AppError(blocker);
    }
  }

  private async run<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
    inUse: 'BUS_IN_USE' | 'SEAT_LAYOUT_IN_USE' = 'BUS_IN_USE',
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(work, TX);
    } catch (error) {
      // Zwei gleichzeitige Busse mit demselben Kennzeichen: Der eindeutige Index entscheidet.
      if (isUniqueViolation(error)) {
        throw new AppError('BUS_PLATE_TAKEN');
      }
      throw mapFleetError(error, inUse);
    }
  }

  private async record(
    tx: Prisma.TransactionClient,
    action: string,
    companyId: string,
    busId: string,
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
        entityType: 'bus',
        entityId: busId,
        data,
      },
      context,
      tx,
    );
  }
}
