import { localDateInDamascus, type RouteStatus } from '@masar/shared';
import { Injectable } from '@nestjs/common';

import { AppError } from '../../common/app-error.js';
import { Clock } from '../../common/clock.js';
import type { RequestContext } from '../../common/request-context.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { fareMatrixIssue } from './domain/fare-matrix.js';
import {
  type FareSet,
  groupFareSets,
  planFareSchedule,
  validFromIssue,
} from './domain/fare-schedule.js';
import { hasDuplicateStations, routeChangeBlocker, routeStatus } from './domain/route-rules.js';
import { fareMatrixError, mapRoutesError } from './routes-errors.js';
import type {
  CreateRouteInput,
  FareMatrixInput,
  ListRoutesQuery,
  ReplaceStopsInput,
  SetFaresInput,
  UpdateRouteInput,
} from './routes.schemas.js';
import {
  type RouteDetailRow,
  RoutesRepository,
  type RouteSummaryRow,
} from './routes.repository.js';

export interface RouteStopView {
  id: string;
  seq: number;
  station: { id: string; nameAr: string; nameEn: string };
  city: { id: string; nameAr: string; nameEn: string };
}

export interface RouteSummaryView {
  id: string;
  nameAr: string;
  nameEn: string;
  status: RouteStatus;
  cancellationPolicy: { id: string; name: string };
  stops: RouteStopView[];
  tripCount: number;
  /** Halte und Stornoregel änderbar (aktiv und von keiner Fahrt genutzt). */
  editable: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface RouteDetailView extends RouteSummaryView {
  /** Heute und künftig gültige Tarifstände, nach Beginn sortiert. */
  fareSets: FareSet[];
}

const TX = { maxWait: 5_000, timeout: 15_000 } as const;

function toSummaryView(row: RouteSummaryRow): RouteSummaryView {
  return {
    id: row.id,
    nameAr: row.nameAr,
    nameEn: row.nameEn,
    status: routeStatus(row.isActive),
    cancellationPolicy: row.cancellationPolicy,
    stops: row.stops.map((stop) => ({
      id: stop.id,
      seq: stop.seq,
      station: { id: stop.station.id, nameAr: stop.station.nameAr, nameEn: stop.station.nameEn },
      city: stop.station.city,
    })),
    tripCount: row.tripCount,
    editable: routeChangeBlocker(row, 'structure') === null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toDetailView(row: RouteDetailRow, today: string): RouteDetailView {
  return { ...toSummaryView(row), fareSets: groupFareSets(row.fares, today) };
}

/**
 * Strecken einer Firma mit Halten in Reihenfolge, Stornoregel und Tarifen je Teilstrecke
 * (Schritt 2.3, ADR 0026). Die Firma kommt nur aus dem geprüften Pfad.
 *
 * Jede Änderung sperrt die Strecken-Zeile (`FOR UPDATE`) und liest danach frisch. Halte und
 * Stornoregel sind eingefroren, sobald eine Fahrt die Strecke nutzt; Preise ändern sich dann über
 * einen neuen Tarifstand ab einem Tag, Halte nur über eine neue Strecke.
 */
@Injectable()
export class RoutesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: RoutesRepository,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  async list(companyId: string, query: ListRoutesQuery): Promise<{ items: RouteSummaryView[] }> {
    const isActive = query.status === undefined ? undefined : query.status === 'ACTIVE';
    const rows = await this.repo.listRoutes(this.prisma, companyId, isActive);
    return { items: rows.map(toSummaryView) };
  }

  async get(companyId: string, routeId: string): Promise<RouteDetailView> {
    const row = await this.repo.findRoute(this.prisma, companyId, routeId);
    if (row === null) {
      throw new AppError('ROUTE_NOT_FOUND');
    }
    return toDetailView(row, this.today());
  }

  async create(
    companyId: string,
    input: CreateRouteInput,
    actor: AuthContext,
    context: RequestContext,
  ): Promise<RouteDetailView> {
    this.checkStopsAndFares(input.stops, input.fares);
    const today = this.today();
    const routeId = await this.run(async (tx) => {
      if (!(await this.repo.policyExists(tx, companyId, input.cancellationPolicyId))) {
        throw new AppError('CANCELLATION_POLICY_NOT_FOUND');
      }
      await this.checkStations(tx, companyId, input.stops);
      const id = await this.repo.insertRoute(tx, {
        companyId,
        cancellationPolicyId: input.cancellationPolicyId,
        nameAr: input.nameAr,
        nameEn: input.nameEn,
      });
      const stopIds = await this.repo.insertStops(tx, id, input.stops);
      await this.repo.insertFares(tx, id, stopIds, { ...input.fares, validFrom: today });
      await this.record(tx, 'ROUTE_CREATED', companyId, id, actor, context, {
        stopCount: input.stops.length,
        fareCount: input.fares.items.length,
        currency: input.fares.currency,
        cancellationPolicyId: input.cancellationPolicyId,
      });
      return id;
    });
    return this.get(companyId, routeId);
  }

  /** Namen jederzeit (außer archiviert); die Stornoregel nur, solange keine Fahrt die Strecke nutzt. */
  async update(
    companyId: string,
    routeId: string,
    input: UpdateRouteInput,
    actor: AuthContext,
    context: RequestContext,
  ): Promise<RouteDetailView> {
    await this.run(async (tx) => {
      const locked = await this.repo.lockRoute(tx, companyId, routeId);
      if (locked === null) {
        throw new AppError('ROUTE_NOT_FOUND');
      }
      const policyChanges =
        input.cancellationPolicyId !== undefined &&
        input.cancellationPolicyId !== locked.cancellationPolicyId;
      const tripCount = policyChanges ? await this.repo.countTripsForRoute(tx, routeId) : 0;
      const blocker = routeChangeBlocker(
        { isActive: locked.isActive, tripCount },
        policyChanges ? 'structure' : 'names',
      );
      if (blocker !== null) {
        throw new AppError(blocker);
      }
      if (
        policyChanges &&
        !(await this.repo.policyExists(tx, companyId, input.cancellationPolicyId ?? ''))
      ) {
        throw new AppError('CANCELLATION_POLICY_NOT_FOUND');
      }
      await this.repo.updateRoute(tx, routeId, input);
      await this.record(tx, 'ROUTE_UPDATED', companyId, routeId, actor, context, {
        fields: Object.keys(input).sort(),
        ...(policyChanges ? { cancellationPolicyId: input.cancellationPolicyId ?? null } : {}),
      });
    });
    return this.get(companyId, routeId);
  }

  /** Ersetzt Halte und Tarife, solange keine Fahrt die Strecke nutzt. Die Tarife gelten ab heute. */
  async replaceStops(
    companyId: string,
    routeId: string,
    input: ReplaceStopsInput,
    actor: AuthContext,
    context: RequestContext,
  ): Promise<RouteDetailView> {
    this.checkStopsAndFares(input.stops, input.fares);
    const today = this.today();
    await this.run(async (tx) => {
      const locked = await this.repo.lockRoute(tx, companyId, routeId);
      if (locked === null) {
        throw new AppError('ROUTE_NOT_FOUND');
      }
      const tripCount = await this.repo.countTripsForRoute(tx, routeId);
      const blocker = routeChangeBlocker({ isActive: locked.isActive, tripCount }, 'structure');
      if (blocker !== null) {
        throw new AppError(blocker);
      }
      await this.checkStations(tx, companyId, input.stops);
      await this.repo.deleteStopsAndFares(tx, routeId);
      const stopIds = await this.repo.insertStops(tx, routeId, input.stops);
      await this.repo.insertFares(tx, routeId, stopIds, { ...input.fares, validFrom: today });
      await this.record(tx, 'ROUTE_STOPS_REPLACED', companyId, routeId, actor, context, {
        stopCount: input.stops.length,
        fareCount: input.fares.items.length,
        currency: input.fares.currency,
      });
    });
    return this.get(companyId, routeId);
  }

  /**
   * Neuer Tarifstand ab `validFrom` (Standard heute), auch für genutzte Strecken. Ältere Stände
   * enden an diesem Tag, spätere werden ersetzt; Buchungen behalten ihren eingefrorenen Preis.
   */
  async setFares(
    companyId: string,
    routeId: string,
    input: SetFaresInput,
    actor: AuthContext,
    context: RequestContext,
  ): Promise<RouteDetailView> {
    const today = this.today();
    const validFrom = input.validFrom ?? today;
    const pastIssue = validFromIssue(validFrom, today);
    if (pastIssue !== null) {
      throw new AppError(pastIssue);
    }
    await this.run(async (tx) => {
      const locked = await this.repo.lockRoute(tx, companyId, routeId);
      if (locked === null) {
        throw new AppError('ROUTE_NOT_FOUND');
      }
      const blocker = routeChangeBlocker({ isActive: locked.isActive, tripCount: 0 }, 'fares');
      if (blocker !== null) {
        throw new AppError(blocker);
      }
      const stopIds = await this.repo.stopIds(tx, routeId);
      const issue = fareMatrixIssue(stopIds.length, input.items);
      if (issue !== null) {
        throw fareMatrixError(issue);
      }
      const plan = planFareSchedule(await this.repo.fareSchedule(tx, routeId), validFrom);
      await this.repo.deleteFares(tx, routeId, plan.deleteIds);
      await this.repo.closeFares(tx, routeId, plan.closeIds, validFrom);
      await this.repo.insertFares(tx, routeId, stopIds, {
        currency: input.currency,
        validFrom,
        items: input.items,
      });
      await this.record(tx, 'ROUTE_FARES_SET', companyId, routeId, actor, context, {
        validFrom,
        currency: input.currency,
        fareCount: input.items.length,
        replaced: plan.deleteIds.length,
        closed: plan.closeIds.length,
      });
    });
    return this.get(companyId, routeId);
  }

  /** Archiviert die Strecke; bestehende Fahrten bleiben. Wiederholung ändert nichts. */
  async archive(
    companyId: string,
    routeId: string,
    actor: AuthContext,
    context: RequestContext,
  ): Promise<RouteDetailView> {
    await this.run(async (tx) => {
      const locked = await this.repo.lockRoute(tx, companyId, routeId);
      if (locked === null) {
        throw new AppError('ROUTE_NOT_FOUND');
      }
      if (!locked.isActive) {
        return;
      }
      await this.repo.updateRoute(tx, routeId, { isActive: false });
      await this.record(tx, 'ROUTE_ARCHIVED', companyId, routeId, actor, context, {});
    });
    return this.get(companyId, routeId);
  }

  private today(): string {
    return localDateInDamascus(this.clock.now());
  }

  /** Prüfungen ohne Datenbank: Haltestellen einmalig, Matrix vollständig und monoton. */
  private checkStopsAndFares(stops: string[], fares: FareMatrixInput): void {
    if (hasDuplicateStations(stops)) {
      throw new AppError('ROUTE_STOP_DUPLICATE');
    }
    const issue = fareMatrixIssue(stops.length, fares.items);
    if (issue !== null) {
      throw fareMatrixError(issue);
    }
  }

  /** Jede Haltestelle muss öffentlich sein oder der Firma gehören; fremde gelten als unbekannt. */
  private async checkStations(
    tx: Prisma.TransactionClient,
    companyId: string,
    stops: string[],
  ): Promise<void> {
    if ((await this.repo.countVisibleStations(tx, companyId, stops)) !== stops.length) {
      throw new AppError('STATION_NOT_FOUND');
    }
  }

  private async run<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(work, TX);
    } catch (error) {
      throw mapRoutesError(error);
    }
  }

  private async record(
    tx: Prisma.TransactionClient,
    action: string,
    companyId: string,
    routeId: string,
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
        entityType: 'route',
        entityId: routeId,
        data,
      },
      context,
      tx,
    );
  }
}
