import type { BookingStatus } from '@masar/shared';

import type { Prisma } from '../../generated/prisma/client.js';

/**
 * Datenzugriff des Buchungskerns. Sperren und Ablauf laufen als explizites SQL (ADR 0004), damit
 * sie genau so im Code stehen, wie sie gemeint sind. Alle Funktionen laufen in der Transaktion des
 * Aufrufers. Sperr-Reihenfolge immer: Fahrt → Buchung → Zahlung.
 */

type Tx = Prisma.TransactionClient;

export interface LockedTrip {
  id: string;
  company_id: string;
  status: string;
  service_date: Date;
  online_sales_close_at: Date;
  cash_deadline_at: Date;
  gender_rule_enabled: boolean;
  company_status: string;
  hold_minutes: number;
}

/**
 * Sperrt die Fahrt-Zeile. Sie ist der Serialisierungspunkt aller Buchungen einer Fahrt (ADR 0005):
 * Wer sie hält, sieht beim folgenden Lesen jede vorher festgeschriebene Belegung.
 */
export async function lockTrip(tx: Tx, tripId: string): Promise<LockedTrip | null> {
  const rows = await tx.$queryRaw<LockedTrip[]>`
    SELECT t.id, t.company_id, t.status, t.service_date, t.online_sales_close_at,
           t.cash_deadline_at, t.gender_rule_enabled, c.status AS company_status, c.hold_minutes
    FROM trip t
    JOIN company c ON c.id = t.company_id
    WHERE t.id = ${tripId}::uuid
    FOR UPDATE OF t`;
  return rows[0] ?? null;
}

/** Sperrt eine Buchung. Nur nach der Sperre ihrer Fahrt aufrufen. */
export async function lockBooking(tx: Tx, bookingId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM booking WHERE id = ${bookingId}::uuid FOR UPDATE`;
}

interface ExpiredRow {
  id: string;
  company_id: string;
  previous_status: BookingStatus;
}

/**
 * Setzt abgelaufene Holds und Barreservierungen einer Fahrt auf EXPIRED und gibt ihre Sitze frei.
 * Nur unter der Sperre der Fahrt aufrufen. Läuft vor jeder neuen Buchung derselben Fahrt, damit kein
 * Sitz blockiert bleibt, wenn der minütliche Job ausfällt.
 */
export async function expireDueOnTrip(tx: Tx, tripId: string, now: Date): Promise<string[]> {
  const expired = await tx.$queryRaw<ExpiredRow[]>`
    WITH due AS (
      SELECT id, status FROM booking
      WHERE trip_id = ${tripId}::uuid
        AND ((status = 'HELD' AND hold_expires_at <= ${now})
          OR (status = 'RESERVED' AND deadline_at <= ${now}))
      FOR UPDATE
    )
    UPDATE booking b
    SET status = 'EXPIRED', expired_at = ${now}, updated_at = ${now}, version = b.version + 1
    FROM due
    WHERE b.id = due.id
    RETURNING b.id, b.company_id, due.status AS previous_status`;
  if (expired.length === 0) {
    return [];
  }
  const ids = expired.map((row) => row.id);
  await tx.$executeRaw`DELETE FROM seat_occupation WHERE booking_id = ANY(${ids}::uuid[])`;
  await tx.outbox.createMany({
    data: expired.map((row) => ({
      type: 'BOOKING_EXPIRED',
      aggregateType: 'booking',
      aggregateId: row.id,
      payload: {
        bookingId: row.id,
        tripId,
        status: 'EXPIRED',
        previousStatus: row.previous_status,
      },
    })),
  });
  await tx.auditLog.createMany({
    data: expired.map((row) => ({
      action: 'BOOKING_EXPIRED',
      actorType: 'SYSTEM' as const,
      companyId: row.company_id,
      entityType: 'booking',
      entityId: row.id,
      data: { previousStatus: row.previous_status },
    })),
  });
  return ids;
}

/** Fahrten mit fälligen Buchungen, für den minütlichen Ablauf-Job. */
export async function tripsWithDueBookings(tx: Tx, now: Date, limit: number): Promise<string[]> {
  const rows = await tx.$queryRaw<{ trip_id: string }[]>`
    SELECT DISTINCT trip_id FROM booking
    WHERE (status = 'HELD' AND hold_expires_at <= ${now})
       OR (status = 'RESERVED' AND deadline_at <= ${now})
    LIMIT ${limit}`;
  return rows.map((row) => row.trip_id);
}

/** Offene, noch nicht abgelaufene Buchungen einer Telefonnummer über alle Fahrten. */
export async function countOpenBookingsForPhone(
  tx: Tx,
  phoneE164: string,
  now: Date,
): Promise<number> {
  const rows = await tx.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM booking
    WHERE contact_phone_e164 = ${phoneE164}
      AND ((status = 'HELD' AND hold_expires_at > ${now})
        OR (status = 'RESERVED' AND deadline_at > ${now})
        OR status = 'PENDING_CONFIRMATION')`;
  return rows[0]?.n ?? 0;
}

export interface OutboxSource {
  id: string;
  tripId: string;
}

/** Ausgehende Nachricht in derselben Transaktion wie die Fachänderung. Nur IDs und Status. */
export async function addOutbox(
  tx: Tx,
  type: string,
  booking: OutboxSource,
  status: BookingStatus,
): Promise<void> {
  await tx.outbox.create({
    data: {
      type,
      aggregateType: 'booking',
      aggregateId: booking.id,
      payload: { bookingId: booking.id, tripId: booking.tripId, status },
    },
  });
}
