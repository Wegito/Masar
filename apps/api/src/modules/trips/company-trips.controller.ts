import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';

import { requestContext } from '../../common/request-context.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CompanyRoles, CurrentAuth } from '../auth/decorators.js';
import {
  companyTripIdSchema,
  type ListTripsQuery,
  listTripsQuerySchema,
  type ScheduleInput,
  scheduleSchema,
  type UpdateQuotaInput,
  updateQuotaSchema,
} from './company-trips.schemas.js';
import {
  type ScheduleResult,
  type TripCancelResult,
  type TripDetailView,
  CompanyTripsService,
  type TripSummaryView,
} from './company-trips.service.js';
import { TRIPS_READ_ROLES, TRIPS_WRITE_ROLES } from './trips.roles.js';

/**
 * Fahrtplanung einer Firma (Schritt 2.4, ADR 0027): Fahrten auflisten und lesen, Wochenplan als
 * Vorschau und veröffentlichen, Fahrt absagen, Kontingent ändern. Lesen alle Rollen der Firma,
 * schreiben nur Admins. Die Firma kommt nur aus dem geprüften Pfad (`CompanyRoleGuard`). Die
 * öffentliche Suche (`/trips/search`) bleibt im `TripsController`.
 */
@Controller('companies/:companyId/trips')
@CompanyRoles({ roles: TRIPS_READ_ROLES })
export class CompanyTripsController {
  constructor(private readonly trips: CompanyTripsService) {}

  @Get()
  list(
    @Param('companyId') companyId: string,
    @Query({ schema: listTripsQuerySchema }) query: ListTripsQuery,
  ): Promise<{ items: TripSummaryView[]; nextCursor: string | null }> {
    return this.trips.list(companyId, query);
  }

  /** Dieselbe Rechnung wie das Veröffentlichen, ohne zu schreiben (Vorschau im Formular). */
  @Post('schedule/preview')
  @HttpCode(200)
  @CompanyRoles({ roles: TRIPS_WRITE_ROLES })
  preview(
    @Param('companyId') companyId: string,
    @Body({ schema: scheduleSchema }) body: ScheduleInput,
  ): Promise<ScheduleResult> {
    return this.trips.preview(companyId, body);
  }

  /** Legt neue Termine als Fahrten an und überspringt vorhandene; Antwort immer 200. */
  @Post('schedule')
  @HttpCode(200)
  @CompanyRoles({ roles: TRIPS_WRITE_ROLES })
  publish(
    @Param('companyId') companyId: string,
    @Body({ schema: scheduleSchema }) body: ScheduleInput,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
  ): Promise<ScheduleResult> {
    return this.trips.publish(companyId, body, auth, requestContext(req));
  }

  @Get(':tripId')
  get(
    @Param('companyId') companyId: string,
    @Param('tripId', { schema: companyTripIdSchema }) tripId: string,
  ): Promise<TripDetailView> {
    return this.trips.get(companyId, tripId);
  }

  /** Absagen: Status `CANCELLED`, aktive Buchungen storniert; Wiederholung ändert nichts. */
  @Post(':tripId/cancel')
  @HttpCode(200)
  @CompanyRoles({ roles: TRIPS_WRITE_ROLES })
  cancel(
    @Param('companyId') companyId: string,
    @Param('tripId', { schema: companyTripIdSchema }) tripId: string,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
  ): Promise<TripCancelResult> {
    return this.trips.cancel(companyId, tripId, auth, requestContext(req));
  }

  /** Online-Kontingent einzelner Sitze; belegte Sitze behalten ihren Kanal. */
  @Put(':tripId/quota')
  @CompanyRoles({ roles: TRIPS_WRITE_ROLES })
  updateQuota(
    @Param('companyId') companyId: string,
    @Param('tripId', { schema: companyTripIdSchema }) tripId: string,
    @Body({ schema: updateQuotaSchema }) body: UpdateQuotaInput,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
  ): Promise<TripDetailView> {
    return this.trips.updateQuota(companyId, tripId, body, auth, requestContext(req));
  }
}
