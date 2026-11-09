import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { requestContext } from '../../common/request-context.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CompanyRoles, CurrentAuth } from '../auth/decorators.js';
import { requireIdempotencyKey } from './bookings.controller.js';
import { BOOKINGS_STAFF_ROLES } from './bookings.roles.js';
import {
  bookingIdSchema,
  type CounterQuoteInput,
  counterQuoteSchema,
  type CounterSeatMapQuery,
  counterSeatMapQuerySchema,
  type CreateBookingInput,
  createBookingSchema,
} from './bookings.schemas.js';
import type { CounterQuote, TicketView } from './bookings.service.js';
import { tripIdSchema } from './company-bookings.schemas.js';
import type { CompanyBookingView } from './company-bookings.service.js';
import { type CounterSeatMapView, CounterService } from './counter.service.js';

/**
 * Schaltermodus (Schritt 2.6, ADR 0030): Admin und Agent verkaufen am Schalter Sitze im selben
 * Inventar wie online, bar bezahlt und sofort bestätigt. Fahrer verkaufen nicht. Die Firma kommt
 * nur aus dem geprüften Pfad (`CompanyRoleGuard`); eine Fahrt oder Buchung einer anderen Firma ist
 * hier unbekannt. Storno läuft über `POST bookings/:bookingId/cancel` (`CompanyBookingsController`).
 */
@Controller('companies/:companyId')
@CompanyRoles({ roles: BOOKINGS_STAFF_ROLES })
export class CounterController {
  constructor(private readonly counter: CounterService) {}

  /** Alle Sitze mit Kontingent und Belegung je Teilstrecke; ohne Halte die ganze Fahrt. */
  @Get('trips/:tripId/counter-seat-map')
  seatMap(
    @Param('companyId') companyId: string,
    @Param('tripId', { schema: tripIdSchema }) tripId: string,
    @Query({ schema: counterSeatMapQuerySchema }) query: CounterSeatMapQuery,
  ): Promise<CounterSeatMapView> {
    return this.counter.seatMap(companyId, tripId, query);
  }

  /** Preis für die Auswahl mit denselben Prüfungen wie der Verkauf, ohne zu schreiben. */
  @Post('counter/quote')
  @HttpCode(200)
  quote(
    @Param('companyId') companyId: string,
    @Body({ schema: counterQuoteSchema }) body: CounterQuoteInput,
  ): Promise<CounterQuote> {
    return this.counter.quote(companyId, body);
  }

  /**
   * Barverkauf: 201 mit der neuen Buchung, 200 bei Wiederholung mit demselben `Idempotency-Key`.
   * Der Body ist derselbe wie bei `POST /bookings`.
   */
  @Post('counter/sales')
  async sell(
    @Param('companyId') companyId: string,
    @Body({ schema: createBookingSchema }) body: CreateBookingInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ booking: CompanyBookingView }> {
    const result = await this.counter.sell(companyId, body, {
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
      actor: auth,
      context: requestContext(req),
    });
    res.status(result.created ? 201 : 200);
    return { booking: result.booking };
  }

  /** Ticket zum Drucken mit QR-Tokens (ADR 0022); QR-Codes nur bei bestätigter Buchung. */
  @Get('bookings/:bookingId/ticket')
  ticket(
    @Param('companyId') companyId: string,
    @Param('bookingId', { schema: bookingIdSchema }) bookingId: string,
  ): Promise<TicketView> {
    return this.counter.ticket(companyId, bookingId);
  }
}
