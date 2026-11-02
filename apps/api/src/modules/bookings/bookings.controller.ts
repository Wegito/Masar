import { Body, Controller, Get, Headers, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { AppError } from '../../common/app-error.js';
import { requestContext } from '../../common/request-context.js';
import { Public } from '../auth/decorators.js';
import {
  bookingIdSchema,
  type CreateBookingInput,
  createBookingSchema,
  type GuestLookupInput,
  guestLookupSchema,
  idempotencyKeySchema,
  manageTokenSchema,
} from './bookings.schemas.js';
import {
  type BookingView,
  BookingsService,
  type LookupResult,
  type TicketView,
} from './bookings.service.js';

/** Header mit dem Verwaltungstoken der Gastbuchung (ADR 0020). Nie in URL oder Query. */
export const MANAGE_TOKEN_HEADER = 'x-manage-token';

function requireIdempotencyKey(value: string | undefined): string {
  const parsed = idempotencyKeySchema.safeParse(value);
  if (!parsed.success) {
    throw new AppError('VALIDATION_FAILED', {
      detail: 'The Idempotency-Key header is missing or malformed.',
      errors: [
        {
          path: 'headers.idempotency-key',
          rule: value === undefined ? 'invalid_type' : 'invalid_format',
        },
      ],
    });
  }
  return parsed.data;
}

/** Fehlendes oder kaputtes Token verhält sich wie ein falsches: BOOKING_NOT_FOUND (ADR 0009). */
function manageToken(value: string | undefined): string {
  const parsed = manageTokenSchema.safeParse(value);
  if (!parsed.success) {
    throw new AppError('BOOKING_NOT_FOUND', { detail: 'The booking does not exist.' });
  }
  return parsed.data;
}

/**
 * Gastbuchung ohne Konto (ADR 0009, 0020). Öffentlich, weil Fahrgäste ohne Anmeldung buchen; der
 * Zugriff auf eine bestehende Buchung verlangt das Verwaltungstoken aus der Antwort von
 * `POST /bookings` im Header `X-Manage-Token`. Die Buchungs-ID im Pfad ist technisch und kein
 * Geheimnis; ohne Token ergibt sie dieselbe 404-Antwort wie eine unbekannte ID.
 */
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  /**
   * Sitze halten. 20 je Minute und IP: Eine echte Buchung braucht eine Handvoll Versuche; mehr
   * deutet auf Blockieren von Sitzen hin. Dazu begrenzt der Service offene Buchungen je Telefon.
   */
  @Public()
  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async create(
    @Body({ schema: createBookingSchema }) body: CreateBookingInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ booking: BookingView; manageToken: string }> {
    const result = await this.bookings.hold(body, {
      channel: 'ONLINE',
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
      context: requestContext(req),
    });
    res.status(result.created ? 201 : 200);
    return { booking: result.booking, manageToken: result.manageToken };
  }

  /**
   * Buchung über Code und Telefon finden (Schritt 1.4, ADR 0009, 0022). Beides nur im Body, nie in
   * der URL. Scharf begrenzt: 5 je Minute und IP, dazu 10 je Stunde und Code im Service. Antwort
   * mit Ticketseite und kurzlebigem Lesetoken.
   */
  @Public()
  @Post('lookup')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  lookup(@Body({ schema: guestLookupSchema }) body: GuestLookupInput): Promise<LookupResult> {
    return this.bookings.lookupForGuest(body.bookingCode, body.phone);
  }

  /** Ticketseite mit QR-Tokens; Verwaltungs- oder Lesetoken im Header `X-Manage-Token`. */
  @Public()
  @Get(':bookingId/ticket')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  ticket(
    @Param('bookingId', { schema: bookingIdSchema }) bookingId: string,
    @Headers(MANAGE_TOKEN_HEADER) token: string | undefined,
  ): Promise<TicketView> {
    return this.bookings.ticketForGuest(bookingId, manageToken(token));
  }

  @Public()
  @Get(':bookingId')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  get(
    @Param('bookingId', { schema: bookingIdSchema }) bookingId: string,
    @Headers(MANAGE_TOKEN_HEADER) token: string | undefined,
  ): Promise<BookingView> {
    return this.bookings.getForGuest(bookingId, manageToken(token));
  }

  /** Barzahlung wählen: `HELD` → `RESERVED` bis zur Barfrist der Fahrt. */
  @Public()
  @Post(':bookingId/reserve-cash')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  reserveCash(
    @Param('bookingId', { schema: bookingIdSchema }) bookingId: string,
    @Headers(MANAGE_TOKEN_HEADER) token: string | undefined,
    @Req() req: Request,
  ): Promise<BookingView> {
    return this.bookings.reserveCash(bookingId, manageToken(token), requestContext(req));
  }

  @Public()
  @Post(':bookingId/cancel')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  cancel(
    @Param('bookingId', { schema: bookingIdSchema }) bookingId: string,
    @Headers(MANAGE_TOKEN_HEADER) token: string | undefined,
    @Req() req: Request,
  ): Promise<BookingView> {
    return this.bookings.cancelByPassenger(bookingId, manageToken(token), requestContext(req));
  }
}
