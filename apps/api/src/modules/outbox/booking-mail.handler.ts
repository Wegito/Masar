import {
  formatBookingCode,
  formatDateTime,
  formatMoney,
  isCurrency,
  type Locale,
} from '@masar/shared';
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service.js';
import { Mailer } from '../mail/mailer.js';
import { bookingMail, type BookingMailKind } from '../mail/templates.js';
import type { BookingEventPayload, BookingEventType } from './outbox.service.js';

const MAIL_KIND: Partial<Record<BookingEventType, BookingMailKind>> = {
  BOOKING_RESERVED: 'RESERVED',
  BOOKING_CONFIRMED: 'CONFIRMED',
  BOOKING_CANCELLED: 'CANCELLED',
};

export type HandlerResult = 'SENT' | 'SKIPPED';

function formatAmount(amountMinor: number, currency: string, locale: Locale): string {
  return isCurrency(currency)
    ? formatMoney({ amountMinor, currency }, locale)
    : `${amountMinor} ${currency}`;
}

/**
 * Benachrichtigt den Kontakt einer Buchung per E-Mail, falls eine Adresse angegeben ist. Ohne
 * Adresse, nach der Pseudonymisierung oder für Ereignisse ohne Nachricht (Hold, Ablauf) ist der
 * Eintrag ohne Versand erledigt. Die Daten werden erst beim Versand gelesen; die Outbox selbst
 * enthält nur IDs.
 */
@Injectable()
export class BookingMailHandler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: Mailer,
  ) {}

  async handle(type: BookingEventType, payload: BookingEventPayload): Promise<HandlerResult> {
    const kind = MAIL_KIND[type];
    if (kind === undefined) {
      return 'SKIPPED';
    }
    const booking = await this.prisma.booking.findUnique({
      where: { id: payload.bookingId },
      select: {
        bookingCode: true,
        status: true,
        locale: true,
        contactEmail: true,
        piiPurgedAt: true,
        deadlineAt: true,
        totalAmountMinor: true,
        currency: true,
        trip: {
          select: {
            departureAt: true,
            company: { select: { nameAr: true, nameEn: true } },
          },
        },
        fromTripStop: {
          select: { departureAt: true, station: { select: { nameAr: true, nameEn: true } } },
        },
        toTripStop: { select: { station: { select: { nameAr: true, nameEn: true } } } },
        passengers: { select: { tripSeat: { select: { seat: { select: { label: true } } } } } },
      },
    });
    if (booking?.contactEmail == null || booking.piiPurgedAt !== null) {
      return 'SKIPPED';
    }
    // Eine Barreservierung, die inzwischen bestätigt, storniert oder verfallen ist, braucht keine
    // Zahlungsaufforderung mehr.
    if (kind === 'RESERVED' && booking.status !== 'RESERVED') {
      return 'SKIPPED';
    }
    // Eine Bestätigung, deren Zustellung erst nach einer Stornierung gelingt (Wiederholung nach
    // Fehlversuch), wäre irreführend.
    if (kind === 'CONFIRMED' && booking.status !== 'CONFIRMED') {
      return 'SKIPPED';
    }
    const locale = booking.locale;
    const name = (value: { nameAr: string; nameEn: string }): string =>
      locale === 'ar' ? value.nameAr : value.nameEn;
    const departureAt = booking.fromTripStop.departureAt ?? booking.trip.departureAt;
    const mail = bookingMail(kind, {
      locale,
      companyName: name(booking.trip.company),
      bookingCode: formatBookingCode(booking.bookingCode),
      departure: formatDateTime(departureAt, locale),
      route: `${name(booking.fromTripStop.station)} – ${name(booking.toTripStop.station)}`,
      total: formatAmount(booking.totalAmountMinor, booking.currency, locale),
      seats: booking.passengers
        .map((passenger) => passenger.tripSeat.seat.label)
        .sort()
        .join(', '),
      deadline: booking.deadlineAt === null ? '' : formatDateTime(booking.deadlineAt, locale),
    });
    await this.mailer.send({ to: booking.contactEmail, ...mail });
    return 'SENT';
  }
}
