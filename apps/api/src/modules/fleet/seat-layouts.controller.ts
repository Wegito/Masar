import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';

import { requestContext } from '../../common/request-context.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CompanyRoles, CurrentAuth } from '../auth/decorators.js';
import { FLEET_READ_ROLES, FLEET_WRITE_ROLES } from './fleet.roles.js';
import {
  type CreateLayoutInput,
  createLayoutSchema,
  layoutIdSchema,
  type LayoutSpecInput,
  layoutSpecSchema,
  type ListLayoutsQuery,
  listLayoutsQuerySchema,
} from './fleet.schemas.js';
import {
  type LayoutDetailView,
  type LayoutPreviewView,
  type LayoutSummaryView,
  SeatLayoutsService,
} from './seat-layouts.service.js';

/**
 * Sitzpläne einer Firma. Lesen dürfen alle Rollen der Firma (Fahrer sehen den Plan ihres Busses),
 * schreiben nur Firmen-Admins. Die Firma kommt nur aus dem geprüften Pfad (`CompanyRoleGuard`).
 */
@Controller('companies/:companyId/seat-layouts')
@CompanyRoles({ roles: FLEET_READ_ROLES })
export class SeatLayoutsController {
  constructor(private readonly layouts: SeatLayoutsService) {}

  @Get()
  list(
    @Param('companyId') companyId: string,
    @Query({ schema: listLayoutsQuerySchema }) query: ListLayoutsQuery,
  ): Promise<{ items: LayoutSummaryView[] }> {
    return this.layouts.list(companyId, query);
  }

  /** Erzeugt einen Plan ohne zu speichern, für die Vorschau im Anlegeformular. */
  @Post('preview')
  @HttpCode(200)
  @CompanyRoles({ roles: FLEET_WRITE_ROLES })
  preview(@Body({ schema: layoutSpecSchema }) body: LayoutSpecInput): LayoutPreviewView {
    return this.layouts.preview(body);
  }

  @Post()
  @CompanyRoles({ roles: FLEET_WRITE_ROLES })
  create(
    @Param('companyId') companyId: string,
    @Body({ schema: createLayoutSchema }) body: CreateLayoutInput,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
  ): Promise<LayoutDetailView> {
    return this.layouts.create(companyId, body, auth, requestContext(req));
  }

  @Get(':layoutId')
  get(
    @Param('companyId') companyId: string,
    @Param('layoutId', { schema: layoutIdSchema }) layoutId: string,
  ): Promise<LayoutDetailView> {
    return this.layouts.get(companyId, layoutId);
  }

  /** Erzeugt den Plan neu, solange keine Fahrt ihn nutzt (sonst `SEAT_LAYOUT_IN_USE`). */
  @Put(':layoutId')
  @CompanyRoles({ roles: FLEET_WRITE_ROLES })
  regenerate(
    @Param('companyId') companyId: string,
    @Param('layoutId', { schema: layoutIdSchema }) layoutId: string,
    @Body({ schema: createLayoutSchema }) body: CreateLayoutInput,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
  ): Promise<LayoutDetailView> {
    return this.layouts.regenerate(companyId, layoutId, body, auth, requestContext(req));
  }

  @Post(':layoutId/versions')
  @CompanyRoles({ roles: FLEET_WRITE_ROLES })
  createVersion(
    @Param('companyId') companyId: string,
    @Param('layoutId', { schema: layoutIdSchema }) layoutId: string,
    @Body({ schema: layoutSpecSchema }) body: LayoutSpecInput,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
  ): Promise<LayoutDetailView> {
    return this.layouts.createVersion(companyId, layoutId, body, auth, requestContext(req));
  }

  @Post(':layoutId/archive')
  @HttpCode(200)
  @CompanyRoles({ roles: FLEET_WRITE_ROLES })
  archive(
    @Param('companyId') companyId: string,
    @Param('layoutId', { schema: layoutIdSchema }) layoutId: string,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
  ): Promise<LayoutDetailView> {
    return this.layouts.retire(companyId, layoutId, auth, requestContext(req));
  }
}
