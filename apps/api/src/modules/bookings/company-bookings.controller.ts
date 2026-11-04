import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import { requestContext } from '../../common/request-context.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CompanyRoles, CurrentAuth } from '../auth/decorators.js';
import { BOOKINGS_STAFF_ROLES } from './bookings.roles.js';
import {
  bookingIdSchema,
  type CompanyCancelInput,
  companyCancelSchema,
  type LookupBookingInput,
  lookupBookingSchema,
} from './bookings.schemas.js';
import { type ListBookingsQuery, listBookingsQuerySchema } from './company-bookings.schemas.js';
import {
  type BookingContactView,
  type BookingListItemView,
  type CompanyBookingView,
  CompanyBookingsService,
} from './company-bookings.service.js';

/**
 * Buchungen aus Sicht des Personals einer Firma (Schritt 2.5, ADR 0028). Die Firma kommt nur aus
 * dem geprüften Pfad (`CompanyRoleGuard`), nie aus dem Body; eine Buchung einer anderen Firma ist
 * hier unbekannt. Fahrer bestätigen erst mit dem Scan (Phase 4), deshalb nur Admin und Agent.
 * Alle Antworten zeigen die Telefonnummer maskiert und die Ausweisnummer nur als „vorhanden".
 */
@Controller('companies/:companyId/bookings')
@CompanyRoles({ roles: BOOKINGS_STAFF_ROLES })
export class CompanyBookingsController {
  constructor(private readonly bookings: CompanyBookingsService) {}

  /**
   * Liste nach Abfahrt mit Filtern und Cursor. Der Suchtext `q` (Code-Anfang, Telefon-Ende) steht
   * als Ausnahme der URL-Regel in der Query (ADR 0028); API und Proxy loggen nur den Pfad.
   */
  @Get()
  list(
    @Param('companyId') companyId: string,
    @Query({ schema: listBookingsQuerySchema }) query: ListBookingsQuery,
  ): Promise<{ items: BookingListItemView[]; nextCursor: string | null }> {
    return this.bookings.list(companyId, query);
  }

  /** Buchung über den Code finden (POST, damit der vollständige Code nie in der URL steht). */
  @Post('lookup')
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  lookup(
    @Param('companyId') companyId: string,
    @Body({ schema: lookupBookingSchema }) body: LookupBookingInput,
  ): Promise<CompanyBookingView> {
    return this.bookings.lookup(companyId, body.bookingCode);
  }

  @Get(':bookingId')
  get(
    @Param('companyId') companyId: string,
    @Param('bookingId', { schema: bookingIdSchema }) bookingId: string,
  ): Promise<CompanyBookingView> {
    return this.bookings.get(companyId, bookingId);
  }

  /** Telefon und E-Mail im Klartext; jeder Aufruf steht im Audit-Log (nur IDs). */
  @Post(':bookingId/reveal-contact')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  revealContact(
    @Param('companyId') companyId: string,
    @Param('bookingId', { schema: bookingIdSchema }) bookingId: string,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
  ): Promise<BookingContactView> {
    return this.bookings.revealContact(companyId, bookingId, auth, requestContext(req));
  }

  /** „Bar bezahlt": erzeugt die Tickets und friert den Provisionssatz ein. */
  @Post(':bookingId/confirm-cash')
  @HttpCode(200)
  confirmCash(
    @Param('companyId') companyId: string,
    @Param('bookingId', { schema: bookingIdSchema }) bookingId: string,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
  ): Promise<CompanyBookingView> {
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
  ): Promise<CompanyBookingView> {
    return this.bookings.cancel(companyId, bookingId, body.reason, auth, requestContext(req));
  }
}
