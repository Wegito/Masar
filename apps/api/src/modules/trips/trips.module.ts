import { Module } from '@nestjs/common';

import { BookingsModule } from '../bookings/bookings.module.js';
import { LicensesModule } from '../licenses/licenses.module.js';
import { CompanyTripsController } from './company-trips.controller.js';
import { CompanyTripsRepository } from './company-trips.repository.js';
import { CompanyTripsService } from './company-trips.service.js';
import { TripsController } from './trips.controller.js';
import { TripsRepository } from './trips.repository.js';
import { TripsService } from './trips.service.js';

/**
 * Fahrten: öffentliche Suche und Sitzplan (Schritt 1.2) und die Fahrtplanung der Firma
 * (Schritt 2.4, ADR 0027). Absage und Kontingent nutzen die Trip-Sperre des Buchungsservice; das
 * Veröffentlichen prüft den Lizenzstand (Schritt 2.7, ADR 0032).
 */
@Module({
  imports: [BookingsModule, LicensesModule],
  controllers: [TripsController, CompanyTripsController],
  providers: [TripsService, TripsRepository, CompanyTripsService, CompanyTripsRepository],
})
export class TripsModule {}
