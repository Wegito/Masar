import { Body, Controller, Get, Param, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';

import { requestContext } from '../../common/request-context.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CompanyRoles, CurrentAuth, PlatformAdminOnly } from '../auth/decorators.js';
import {
  type CreateLicenseInput,
  createLicenseSchema,
  type UpdateLicenseInput,
  updateLicenseSchema,
} from './licenses.schemas.js';
import {
  type AdminCompanyListItem,
  type AdminLicenseView,
  LicensesService,
  type LicenseView,
} from './licenses.service.js';

const companyIdSchema = z.uuid();

/**
 * Lizenzstand der eigenen Firma (Schritt 2.7, ADR 0032): lesen für alle Rollen, auch Fahrer, damit
 * das Portal den Hinweis im Rahmen zeigen kann. Plattform-Admins dürfen ohne Mitgliedschaft lesen.
 * Ändern kann die Firma ihren Stand nie.
 */
@Controller('companies/:companyId/license')
@CompanyRoles({ roles: ['ADMIN', 'AGENT', 'DRIVER'], allowPlatformAdmin: true })
export class CompanyLicenseController {
  constructor(private readonly licenses: LicensesService) {}

  @Get()
  get(@Param('companyId') companyId: string): Promise<LicenseView> {
    return this.licenses.get(companyId);
  }
}

/**
 * Pflege des Lizenzstands durch den Plattform-Admin (`/admin`, docs/architektur.md). Rechnungen
 * und Preise entstehen außerhalb; hier stehen nur Plan, Zeitraum und Pakete. Jede Änderung
 * schreibt einen Audit-Eintrag mit IDs und Zahlen, ohne die Notiz.
 */
@Controller('admin/companies')
@PlatformAdminOnly()
export class AdminLicensesController {
  constructor(private readonly licenses: LicensesService) {}

  @Get()
  list(): Promise<{ items: AdminCompanyListItem[] }> {
    return this.licenses.listCompanies();
  }

  @Get(':companyId/license')
  get(
    @Param('companyId', { schema: companyIdSchema }) companyId: string,
  ): Promise<AdminLicenseView> {
    return this.licenses.getForAdmin(companyId);
  }

  /** Neuer Zeitraum (setzen oder verlängern), Antwort 201 mit dem ganzen Stand. */
  @Post(':companyId/license')
  create(
    @Param('companyId', { schema: companyIdSchema }) companyId: string,
    @Body({ schema: createLicenseSchema }) body: CreateLicenseInput,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
  ): Promise<AdminLicenseView> {
    return this.licenses.create(companyId, body, auth, requestContext(req));
  }

  /** Laufenden (oder gewählten) Zeitraum ändern: Pakete, Ende, Plan, Notiz. */
  @Put(':companyId/license')
  update(
    @Param('companyId', { schema: companyIdSchema }) companyId: string,
    @Body({ schema: updateLicenseSchema }) body: UpdateLicenseInput,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
  ): Promise<AdminLicenseView> {
    return this.licenses.update(companyId, body, auth, requestContext(req));
  }
}
