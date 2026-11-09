import type { BookingStatus } from '@masar/shared';
import { Injectable } from '@nestjs/common';

import type { Prisma } from '../../generated/prisma/client.js';

/** Fachereignisse der Buchung. Jede Statusänderung schreibt genau eines. */
export const BOOKING_EVENT_TYPES = [
  'BOOKING_HELD',
  'BOOKING_RESERVED',
  'BOOKING_CONFIRMED',
  'BOOKING_CANCELLED',
  'BOOKING_EXPIRED',
] as const;
export type BookingEventType = (typeof BOOKING_EVENT_TYPES)[number];

/** Nur IDs und Status, nie Personendaten oder Tokens (Schema-Kommentar zu `outbox`). */
export interface BookingEventPayload {
  bookingId: string;
  status: BookingStatus;
  previousStatus: BookingStatus | null;
}

type OutboxWriter = Pick<Prisma.TransactionClient, 'outbox'>;

/**
 * Schreibt Einträge in den transaktionalen Ausgang. Der Aufrufer übergibt den Client seiner
 * Transaktion: Fachänderung und Eintrag gelingen gemeinsam oder gar nicht.
 */
@Injectable()
export class OutboxService {
  async enqueueBookingEvent(
    writer: OutboxWriter,
    type: BookingEventType,
    payload: BookingEventPayload,
    now: Date,
  ): Promise<void> {
    await writer.outbox.create({
      data: {
        type,
        aggregateType: 'booking',
        aggregateId: payload.bookingId,
        payload: { ...payload },
        // Fällig nach der Uhr der Anwendung; `created_at` setzt die Datenbank und hält die Reihenfolge.
        nextAttemptAt: now,
      },
    });
  }
}
