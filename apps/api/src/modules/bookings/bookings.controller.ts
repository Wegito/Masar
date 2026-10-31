import {
  Body,
  Controller,
  createParamDecorator,
  type ExecutionContext,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { AppError } from '../../common/app-error.js';
import { requestContext } from '../../common/request-context.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CompanyRoles, CurrentAuth, Public } from '../auth/decorators.js';
import type { BookingView } from './booking-view.js';
import {
  type BookingCodeQuery,
  bookingCodeQuerySchema,
  bookingIdSchema,
  type CancelByCompanyInput,
  cancelByCompanySchema,
  type CreateBookingInput,
  createBookingSchema,
  IDEMPOTENCY_KEY_PATTERN,
} from './bookings.schemas.js';
import { BookingsService } from './bookings.service.js';

/**
 * Verwaltungstoken eines Gasts aus dem Header `X-Booking-Token`. Bewusst nicht in Pfad oder Query:
 * Der Pfad landet im Log, und weder Token noch Buchungscode dürfen dort stehen. Ein Token in
 * falscher Form gilt als fehlend; beides ergibt BOOKING_NOT_FOUND.
 */
const BookingToken = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const value = ctx.switchToHttp().getRequest<Request>().headers['x-booking-token'];
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
});

/**
 * Buchen ohne Konto (ADR 0009). `POST /bookings` legt einen Hold an und liefert einmalig das
 * Verwaltungstoken; alles Weitere läuft über `/my-booking` mit diesem Token im Header.
 */
@Controller()
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Public()
  @Post('bookings')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  async create(
    @Body({ schema: createBookingSchema }) body: CreateBookingInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<BookingView & { manageToken?: string }> {
    if (idempotencyKey === undefined || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      throw new AppError('VALIDATION_FAILED', {
        detail: 'Idempotency-Key header is required.',
        errors: [{ path: 'Idempotency-Key', rule: 'required' }],
      });
    }
    const result = await this.bookings.create(body, idempotencyKey, requestContext(req));
    if (result.replayed) {
      res.status(200).setHeader('Idempotent-Replayed', 'true');
      return result.view;
    }
    res.status(201);
    return { ...result.view, manageToken: result.manageToken };
  }

  @Public()
  @Get('my-booking')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  view(@BookingToken() token: string | undefined): Promise<BookingView> {
    return this.bookings.viewByToken(token);
  }

  @Public()
  @Post('my-booking/cash')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  reserveCash(
    @BookingToken() token: string | undefined,
    @Req() req: Request,
  ): Promise<BookingView> {
    return this.bookings.reserveCash(token, requestContext(req));
  }

  @Public()
  @Post('my-booking/cancel')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  cancel(@BookingToken() token: string | undefined, @Req() req: Request): Promise<BookingView> {
    return this.bookings.cancelByPassenger(token, requestContext(req));
  }
}

/** Buchungen einer Firma für ihr Personal. `companyId` prüft der Guard gegen die Mitgliedschaft. */
@Controller('companies/:companyId/bookings')
export class CompanyBookingsController {
  constructor(private readonly bookings: BookingsService) {}

  /** Suche nach Buchungscode, z. B. am Schalter. Der Code steht in der Query, die nicht geloggt wird. */
  @Get()
  @CompanyRoles({ roles: ['ADMIN', 'AGENT'] })
  @Header('Cache-Control', 'no-store')
  findByCode(
    @Param('companyId') companyId: string,
    @Query({ schema: bookingCodeQuerySchema }) query: BookingCodeQuery,
  ) {
    return this.bookings.findForCompany(companyId, query.code);
  }

  @Post(':bookingId/confirm-cash')
  @HttpCode(200)
  @CompanyRoles({ roles: ['ADMIN', 'AGENT'] })
  confirmCash(
    @Param('companyId') companyId: string,
    @Param('bookingId', { schema: bookingIdSchema }) bookingId: string,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
  ) {
    return this.bookings.confirmCash(companyId, bookingId, auth, requestContext(req));
  }

  @Post(':bookingId/cancel')
  @HttpCode(200)
  @CompanyRoles({ roles: ['ADMIN', 'AGENT'] })
  cancel(
    @Param('companyId') companyId: string,
    @Param('bookingId', { schema: bookingIdSchema }) bookingId: string,
    @Body({ schema: cancelByCompanySchema }) body: CancelByCompanyInput,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
  ) {
    return this.bookings.cancelByCompany(
      companyId,
      bookingId,
      body.reason,
      auth,
      requestContext(req),
    );
  }
}
