import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';

import { requestContext } from '../../common/request-context.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CompanyRoles, CurrentAuth } from '../auth/decorators.js';
import {
  type CityStationsView,
  type PolicyView,
  RouteCatalogService,
  type StationView,
} from './route-catalog.service.js';
import { ROUTES_READ_ROLES, ROUTES_WRITE_ROLES } from './routes.roles.js';
import {
  type CreatePolicyInput,
  createPolicySchema,
  type CreateStationInput,
  createStationSchema,
  policyIdSchema,
} from './routes.schemas.js';

/** Haltestellen-Katalog: alle Städte mit öffentlichen und eigenen Haltestellen der Firma. */
@Controller('companies/:companyId/stations')
@CompanyRoles({ roles: ROUTES_READ_ROLES })
export class StationsController {
  constructor(private readonly catalog: RouteCatalogService) {}

  @Get()
  list(@Param('companyId') companyId: string): Promise<{ items: CityStationsView[] }> {
    return this.catalog.stations(companyId);
  }

  /** Eigene Haltestelle der Firma in einer bestehenden Stadt. */
  @Post()
  @CompanyRoles({ roles: ROUTES_WRITE_ROLES })
  create(
    @Param('companyId') companyId: string,
    @Body({ schema: createStationSchema }) body: CreateStationInput,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
  ): Promise<StationView & { cityId: string }> {
    return this.catalog.createStation(companyId, body, auth, requestContext(req));
  }
}

/** Stornoregeln der Firma: anlegen und lesen; nach dem Anlegen unveränderlich. */
@Controller('companies/:companyId/cancellation-policies')
@CompanyRoles({ roles: ROUTES_READ_ROLES })
export class CancellationPoliciesController {
  constructor(private readonly catalog: RouteCatalogService) {}

  @Get()
  list(@Param('companyId') companyId: string): Promise<{ items: PolicyView[] }> {
    return this.catalog.policies(companyId);
  }

  @Post()
  @CompanyRoles({ roles: ROUTES_WRITE_ROLES })
  create(
    @Param('companyId') companyId: string,
    @Body({ schema: createPolicySchema }) body: CreatePolicyInput,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
  ): Promise<PolicyView> {
    return this.catalog.createPolicy(companyId, body, auth, requestContext(req));
  }

  @Get(':policyId')
  get(
    @Param('companyId') companyId: string,
    @Param('policyId', { schema: policyIdSchema }) policyId: string,
  ): Promise<PolicyView> {
    return this.catalog.policy(companyId, policyId);
  }
}
