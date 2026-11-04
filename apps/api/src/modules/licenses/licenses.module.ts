import { Module } from '@nestjs/common';

import { AdminLicensesController, CompanyLicenseController } from './licenses.controller.js';
import { LicensesRepository } from './licenses.repository.js';
import { LicensesService } from './licenses.service.js';

/**
 * Lizenzstand je Firma (Schritt 2.7, ADR 0029 und 0032). Exportiert den Service für die
 * Fahrtplanung (Prüfung beim Veröffentlichen) und die Flotte (Sperre beim Aktivieren von Bussen).
 */
@Module({
  controllers: [CompanyLicenseController, AdminLicensesController],
  providers: [LicensesService, LicensesRepository],
  exports: [LicensesService],
})
export class LicensesModule {}
