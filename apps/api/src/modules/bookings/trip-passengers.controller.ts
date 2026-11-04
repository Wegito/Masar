import { Controller, Get, Param } from '@nestjs/common';

import { CompanyRoles } from '../auth/decorators.js';
import { TRIP_PASSENGERS_ROLES } from './bookings.roles.js';
import { tripIdSchema } from './company-bookings.schemas.js';
import { CompanyBookingsService, type TripPassengersView } from './company-bookings.service.js';

/**
 * Fahrgastliste einer Fahrt (Schritt 2.5, ADR 0028) für Fahrer und Schalter: Sitz, Name,
 * Geschlecht, Zustieg und Ausstieg, Zahlungsstand. Ohne Telefon, E-Mail, Buchungscode und
 * Ausweisnummer (nur „vorhanden"). Im Buchungsmodul, weil sie Buchungsdaten liest; der Pfad liegt
 * neben der Fahrtplanung (`CompanyTripsController`).
 */
@Controller('companies/:companyId/trips')
@CompanyRoles({ roles: TRIP_PASSENGERS_ROLES })
export class TripPassengersController {
  constructor(private readonly bookings: CompanyBookingsService) {}

  @Get(':tripId/passengers')
  passengers(
    @Param('companyId') companyId: string,
    @Param('tripId', { schema: tripIdSchema }) tripId: string,
  ): Promise<TripPassengersView> {
    return this.bookings.tripPassengers(companyId, tripId);
  }
}
