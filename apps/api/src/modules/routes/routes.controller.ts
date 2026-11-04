import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';

import { requestContext } from '../../common/request-context.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CompanyRoles, CurrentAuth } from '../auth/decorators.js';
import { ROUTES_READ_ROLES, ROUTES_WRITE_ROLES } from './routes.roles.js';
import {
  type CreateRouteInput,
  createRouteSchema,
  type ListRoutesQuery,
  listRoutesQuerySchema,
  type ReplaceStopsInput,
  replaceStopsSchema,
  routeIdSchema,
  type SetFaresInput,
  setFaresSchema,
  type UpdateRouteInput,
  updateRouteSchema,
} from './routes.schemas.js';
import { type RouteDetailView, RoutesService, type RouteSummaryView } from './routes.service.js';

/**
 * Strecken einer Firma mit Halten, Stornoregel und Tarifen je Teilstrecke. Lesen alle Rollen der
 * Firma, schreiben nur Admins. Die Firma kommt nur aus dem geprüften Pfad (`CompanyRoleGuard`).
 */
@Controller('companies/:companyId/routes')
@CompanyRoles({ roles: ROUTES_READ_ROLES })
export class RoutesController {
  constructor(private readonly routes: RoutesService) {}

  @Get()
  list(
    @Param('companyId') companyId: string,
    @Query({ schema: listRoutesQuerySchema }) query: ListRoutesQuery,
  ): Promise<{ items: RouteSummaryView[] }> {
    return this.routes.list(companyId, query);
  }

  @Post()
  @CompanyRoles({ roles: ROUTES_WRITE_ROLES })
  create(
    @Param('companyId') companyId: string,
    @Body({ schema: createRouteSchema }) body: CreateRouteInput,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
  ): Promise<RouteDetailView> {
    return this.routes.create(companyId, body, auth, requestContext(req));
  }

  @Get(':routeId')
  get(
    @Param('companyId') companyId: string,
    @Param('routeId', { schema: routeIdSchema }) routeId: string,
  ): Promise<RouteDetailView> {
    return this.routes.get(companyId, routeId);
  }

  /** Namen und Stornoregel; die Regel nur, solange keine Fahrt die Strecke nutzt. */
  @Patch(':routeId')
  @CompanyRoles({ roles: ROUTES_WRITE_ROLES })
  update(
    @Param('companyId') companyId: string,
    @Param('routeId', { schema: routeIdSchema }) routeId: string,
    @Body({ schema: updateRouteSchema }) body: UpdateRouteInput,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
  ): Promise<RouteDetailView> {
    return this.routes.update(companyId, routeId, body, auth, requestContext(req));
  }

  /** Halte und Tarife ersetzen, solange keine Fahrt die Strecke nutzt (sonst `ROUTE_IN_USE`). */
  @Put(':routeId/stops')
  @CompanyRoles({ roles: ROUTES_WRITE_ROLES })
  replaceStops(
    @Param('companyId') companyId: string,
    @Param('routeId', { schema: routeIdSchema }) routeId: string,
    @Body({ schema: replaceStopsSchema }) body: ReplaceStopsInput,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
  ): Promise<RouteDetailView> {
    return this.routes.replaceStops(companyId, routeId, body, auth, requestContext(req));
  }

  /** Neuer Tarifstand ab einem Tag, auch für genutzte Strecken. */
  @Put(':routeId/fares')
  @CompanyRoles({ roles: ROUTES_WRITE_ROLES })
  setFares(
    @Param('companyId') companyId: string,
    @Param('routeId', { schema: routeIdSchema }) routeId: string,
    @Body({ schema: setFaresSchema }) body: SetFaresInput,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
  ): Promise<RouteDetailView> {
    return this.routes.setFares(companyId, routeId, body, auth, requestContext(req));
  }

  @Post(':routeId/archive')
  @HttpCode(200)
  @CompanyRoles({ roles: ROUTES_WRITE_ROLES })
  archive(
    @Param('companyId') companyId: string,
    @Param('routeId', { schema: routeIdSchema }) routeId: string,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
  ): Promise<RouteDetailView> {
    return this.routes.archive(companyId, routeId, auth, requestContext(req));
  }
}
