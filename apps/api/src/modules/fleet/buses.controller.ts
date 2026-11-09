import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';

import { requestContext } from '../../common/request-context.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CompanyRoles, CurrentAuth } from '../auth/decorators.js';
import { BusesService, type BusView } from './buses.service.js';
import { FLEET_READ_ROLES, FLEET_WRITE_ROLES } from './fleet.roles.js';
import {
  busIdSchema,
  type CreateBusInput,
  createBusSchema,
  type UpdateBusInput,
  updateBusSchema,
} from './fleet.schemas.js';

/** Busse einer Firma; Rollen wie bei den Sitzplänen. */
@Controller('companies/:companyId/buses')
@CompanyRoles({ roles: FLEET_READ_ROLES })
export class BusesController {
  constructor(private readonly buses: BusesService) {}

  @Get()
  list(@Param('companyId') companyId: string): Promise<{ items: BusView[] }> {
    return this.buses.list(companyId);
  }

  @Post()
  @CompanyRoles({ roles: FLEET_WRITE_ROLES })
  create(
    @Param('companyId') companyId: string,
    @Body({ schema: createBusSchema }) body: CreateBusInput,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
  ): Promise<BusView> {
    return this.buses.create(companyId, body, auth, requestContext(req));
  }

  @Get(':busId')
  get(
    @Param('companyId') companyId: string,
    @Param('busId', { schema: busIdSchema }) busId: string,
  ): Promise<BusView> {
    return this.buses.get(companyId, busId);
  }

  @Patch(':busId')
  @CompanyRoles({ roles: FLEET_WRITE_ROLES })
  update(
    @Param('companyId') companyId: string,
    @Param('busId', { schema: busIdSchema }) busId: string,
    @Body({ schema: updateBusSchema }) body: UpdateBusInput,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
  ): Promise<BusView> {
    return this.buses.update(companyId, busId, body, auth, requestContext(req));
  }

  @Post(':busId/deactivate')
  @HttpCode(200)
  @CompanyRoles({ roles: FLEET_WRITE_ROLES })
  deactivate(
    @Param('companyId') companyId: string,
    @Param('busId', { schema: busIdSchema }) busId: string,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
  ): Promise<BusView> {
    return this.buses.setStatus(companyId, busId, 'INACTIVE', auth, requestContext(req));
  }

  @Post(':busId/activate')
  @HttpCode(200)
  @CompanyRoles({ roles: FLEET_WRITE_ROLES })
  activate(
    @Param('companyId') companyId: string,
    @Param('busId', { schema: busIdSchema }) busId: string,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
  ): Promise<BusView> {
    return this.buses.setStatus(companyId, busId, 'ACTIVE', auth, requestContext(req));
  }
}
