import { Controller, Get, Header, Param, Query } from '@nestjs/common';

import { Public } from '../auth/decorators.js';
import {
  type SeatMapQuery,
  seatMapSchema,
  tripIdSchema,
  type TripSearchQuery,
  tripSearchSchema,
} from './trips.schemas.js';
import { TripsService } from './trips.service.js';

/**
 * Öffentlich, weil Fahrgäste ohne Konto suchen und buchen (ADR 0009). Beide Antworten ändern sich
 * mit jeder Buchung und dürfen deshalb nirgends zwischengespeichert werden. Die Zahl freier Plätze
 * ist gekappt, und das Geschlecht anderer Fahrgäste erscheint nie (ADR 0006, 0007).
 */
@Controller('trips')
export class TripsController {
  constructor(private readonly trips: TripsService) {}

  @Public()
  @Get('search')
  @Header('Cache-Control', 'no-store')
  search(@Query({ schema: tripSearchSchema }) query: TripSearchQuery) {
    return this.trips.search(query);
  }

  @Public()
  @Get(':tripId/seat-map')
  @Header('Cache-Control', 'no-store')
  seatMap(
    @Param('tripId', { schema: tripIdSchema }) tripId: string,
    @Query({ schema: seatMapSchema }) query: SeatMapQuery,
  ) {
    return this.trips.seatMap(tripId, query);
  }
}
