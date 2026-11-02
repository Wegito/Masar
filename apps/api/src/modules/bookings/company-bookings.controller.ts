import { Body, Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import { requestContext } from '../../common/request-context.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CompanyRoles, CurrentAuth } from '../auth/decorators.js';
import {
  bookingIdSchema,
  type CompanyCancelInput,
  companyCancelSchema,
  type LookupBookingInput,
  lookupBookingSchema,
} from './bookings.schemas.js';
import { type BookingView, BookingsService } from './bookings.service.js';

/**
 * Buchungen aus Sicht des Personals einer Firma. Die Firma kommt nur aus dem geprüften Pfad
 * (`CompanyRoleGuard`), nie aus dem Body; eine Buchung einer anderen Firma ist hier unbekannt.
 * Fahrer bestätigen erst mit dem Scan (Phase 4), deshalb nur Admin und Agent.
 */
@Controller('companies/:companyId/bookings')
@CompanyRoles({ roles: ['ADMIN', 'AGENT'] })
export class CompanyBookingsController {
  constructor(private readonly bookings: BookingsService) {}

  /** Buchung über den Code finden (POST, damit der Code nie in der URL steht). */
  @Post('lookup')
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  lookup(
    @Param('companyId') companyId: string,
    @Body({ schema: lookupBookingSchema }) body: LookupBookingInput,
  ): Promise<BookingView> {
    return this.bookings.lookupForCompany(companyId, body.bookingCode);
  }

  /** „Bar bezahlt": erzeugt die Tickets und friert den Provisionssatz ein. */
  @Post(':bookingId/confirm-cash')
  @HttpCode(200)
  confirmCash(
    @Param('companyId') companyId: string,
    @Param('bookingId', { schema: bookingIdSchema }) bookingId: string,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
  ): Promise<BookingView> {
    return this.bookings.confirmCash(companyId, bookingId, auth, requestContext(req));
  }

  @Post(':bookingId/cancel')
  @HttpCode(200)
  cancel(
    @Param('companyId') companyId: string,
    @Param('bookingId', { schema: bookingIdSchema }) bookingId: string,
    @Body({ schema: companyCancelSchema }) body: CompanyCancelInput,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
  ): Promise<BookingView> {
    return this.bookings.cancelByCompany(
      companyId,
      bookingId,
      body.reason,
      auth,
      requestContext(req),
    );
  }
}
