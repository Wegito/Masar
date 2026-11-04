import { Injectable } from '@nestjs/common';

import { AppError } from '../../common/app-error.js';
import type { RequestContext } from '../../common/request-context.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { cancellationRulesIssue } from './domain/cancellation-rules.js';
import type { CreatePolicyInput, CreateStationInput } from './routes.schemas.js';
import { type PolicyRow, RoutesRepository, type StationRow } from './routes.repository.js';

export interface StationView {
  id: string;
  nameAr: string;
  nameEn: string;
  /** Eigene Haltestelle der Firma; sonst öffentlich (von der Plattform gepflegt). */
  own: boolean;
}

export interface CityStationsView {
  id: string;
  slug: string;
  nameAr: string;
  nameEn: string;
  stations: StationView[];
}

export interface PolicyView {
  id: string;
  name: string;
  allowPassengerCancel: boolean;
  /** Stufen, größte Schwelle zuerst. */
  rules: { minMinutesBeforeDeparture: number; feeBps: number }[];
  routeCount: number;
  createdAt: Date;
}

function toStationView(row: StationRow): StationView {
  return { id: row.id, nameAr: row.nameAr, nameEn: row.nameEn, own: row.ownerCompanyId !== null };
}

function toPolicyView(row: PolicyRow): PolicyView {
  return {
    id: row.id,
    name: row.name,
    allowPassengerCancel: row.allowPassengerCancel,
    rules: row.rules,
    routeCount: row.routeCount,
    createdAt: row.createdAt,
  };
}

/**
 * Haltestellen-Katalog und Stornoregeln einer Firma (Schritt 2.3, ADR 0026).
 *
 * Städte und öffentliche Haltestellen (Busbahnhöfe) pflegt die Plattform; eine Firma liest sie und
 * darf eigene Haltestellen anlegen (Büro, Garage, eigener Halteplatz), die nur sie sieht und nutzt.
 * Stornoregeln sind nach dem Anlegen unveränderlich: Buchungen stornieren nach der Regel ihrer
 * Strecke, eine Änderung wirkte rückwirkend auf verkaufte Tickets.
 */
@Injectable()
export class RouteCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: RoutesRepository,
    private readonly audit: AuditService,
  ) {}

  async stations(companyId: string): Promise<{ items: CityStationsView[] }> {
    const cities = await this.repo.stationCatalog(this.prisma, companyId);
    return {
      items: cities.map((city) => ({ ...city, stations: city.stations.map(toStationView) })),
    };
  }

  async createStation(
    companyId: string,
    input: CreateStationInput,
    actor: AuthContext,
    context: RequestContext,
  ): Promise<StationView & { cityId: string }> {
    return this.prisma.$transaction(async (tx) => {
      if (!(await this.repo.cityExists(tx, input.cityId))) {
        throw new AppError('CITY_NOT_FOUND');
      }
      const row = await this.repo.insertStation(tx, { ...input, ownerCompanyId: companyId });
      await this.record(tx, 'STATION_CREATED', companyId, 'station', row.id, actor, context, {
        cityId: input.cityId,
      });
      return { ...toStationView(row), cityId: row.cityId };
    });
  }

  async policies(companyId: string): Promise<{ items: PolicyView[] }> {
    const rows = await this.repo.listPolicies(this.prisma, companyId);
    return { items: rows.map(toPolicyView) };
  }

  async policy(companyId: string, policyId: string): Promise<PolicyView> {
    const row = await this.repo.findPolicy(this.prisma, companyId, policyId);
    if (row === null) {
      throw new AppError('CANCELLATION_POLICY_NOT_FOUND');
    }
    return toPolicyView(row);
  }

  async createPolicy(
    companyId: string,
    input: CreatePolicyInput,
    actor: AuthContext,
    context: RequestContext,
  ): Promise<PolicyView> {
    const issue = cancellationRulesIssue(input.rules);
    if (issue !== null) {
      throw new AppError(issue);
    }
    const id = await this.prisma.$transaction(async (tx) => {
      const policyId = await this.repo.insertPolicy(tx, { companyId, ...input });
      await this.record(
        tx,
        'CANCELLATION_POLICY_CREATED',
        companyId,
        'cancellation_policy',
        policyId,
        actor,
        context,
        { allowPassengerCancel: input.allowPassengerCancel, ruleCount: input.rules.length },
      );
      return policyId;
    });
    return this.policy(companyId, id);
  }

  private async record(
    tx: Prisma.TransactionClient,
    action: string,
    companyId: string,
    entityType: string,
    entityId: string,
    actor: AuthContext,
    context: RequestContext,
    data: Prisma.InputJsonObject,
  ): Promise<void> {
    await this.audit.record(
      { action, actorType: 'USER', actorId: actor.userId, companyId, entityType, entityId, data },
      context,
      tx,
    );
  }
}
