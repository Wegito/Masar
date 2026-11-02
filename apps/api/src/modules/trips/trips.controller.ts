import { Controller, Get, Param, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { Public } from '../auth/decorators.js';
import {
  type SeatMapQuery,
  seatMapQuerySchema,
  tripIdSchema,
  type TripSearchQuery,
  tripSearchSchema,
} from './trips.schemas.js';
import { type SeatMapResult, type TripSearchResult, TripsService } from './trips.service.js';

/**
 * Fahrtensuche und Sitzplan für Fahrgäste. Öffentlich, weil Gäste ohne Konto suchen und buchen
 * (ADR 0009). Beide Routen lesen nur und geben keine personenbezogenen Daten heraus: freie Sitze
 * nur gekappt, im Sitzplan je Sitz nur ein Status, nie das Geschlecht anderer Fahrgäste.
 */
@Controller('trips')
export class TripsController {
  constructor(private readonly trips: TripsService) {}

  /** 60 je Minute und IP: genug zum Blättern durch Tage, bremst systematisches Abgreifen. */
  @Public()
  @Get('search')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  search(@Query({ schema: tripSearchSchema }) query: TripSearchQuery): Promise<TripSearchResult> {
    return this.trips.search(query);
  }

  /**
   * 60 je Minute und IP. Das Limit bremst auch den Vergleich der Sitzpläne für beide Geschlechter,
   * den ADR 0006 als Restrisiko hinnimmt.
   */
  @Public()
  @Get(':tripId/seat-map')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  seatMap(
    @Param('tripId', { schema: tripIdSchema }) tripId: string,
    @Query({ schema: seatMapQuerySchema }) query: SeatMapQuery,
  ): Promise<SeatMapResult> {
    return this.trips.seatMap(tripId, query);
  }
}
