import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { Public } from '../auth/decorators.js';
import {
  type SeatMapRequest,
  seatMapRequestSchema,
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
   * Sitzplan als `POST` mit JSON-Body, damit die Geschlechter der Fahrgäste nie in einer URL stehen
   * (ADR 0034). Liest nur, deshalb 200 statt 201. 60 je Minute und IP; das Limit bremst auch das
   * systematische Abfragen, das ADR 0006 als Restrisiko hinnimmt.
   */
  @Public()
  @Post(':tripId/seat-map')
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  seatMap(
    @Param('tripId', { schema: tripIdSchema }) tripId: string,
    @Body({ schema: seatMapRequestSchema }) body: SeatMapRequest,
  ): Promise<SeatMapResult> {
    return this.trips.seatMap(tripId, body);
  }
}
