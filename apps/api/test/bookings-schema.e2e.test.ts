import { randomUUID } from 'node:crypto';

import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaClient } from '../src/generated/prisma/client.js';
import { resetDatabase } from './helpers/app.js';
import {
  type BookingRows,
  createInventoryFixture,
  insertBookingRows,
  type InventoryFixture,
  seatId,
} from './helpers/inventory.js';

/**
 * Datenbankregeln des Buchungskerns (Schritt 1.3). Schreibzugriffe absichtlich per SQL an der
 * Anwendung vorbei: Auch ein fehlerhafter Schreibpfad darf keine inkonsistente Buchung hinterlassen.
 */

const APP_DATABASE_URL = process.env.DATABASE_URL as string;

interface PgError {
  code: string;
  constraint?: string;
}

async function failure(promise: Promise<unknown>): Promise<PgError> {
  try {
    await promise;
  } catch (error) {
    return error as PgError;
  }
  throw new Error('Die Anweisung hätte scheitern müssen');
}

let prisma: PrismaClient;
let sql: pg.Client;
let trip: InventoryFixture;
let other: InventoryFixture;
let rows: BookingRows;

beforeAll(async () => {
  await resetDatabase();
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: APP_DATABASE_URL }) });
  trip = await createInventoryFixture(prisma);
  other = await createInventoryFixture(prisma);
  // Buchung auf Sitz 1 für Homs → Hama [1,2).
  rows = await insertBookingRows(prisma, trip, ['1'], { fromSeq: 1, toSeq: 2 }, 'FEMALE');
  sql = new pg.Client({ connectionString: APP_DATABASE_URL });
  await sql.connect();
});

afterAll(async () => {
  await sql.end();
  await prisma.$disconnect();
});

function insertOccupation(seat: string, fromSeq: number, toSeq: number) {
  return sql.query(
    `INSERT INTO seat_occupation (trip_id, seat_id, from_seq, to_seq, booking_id, booking_passenger_id, gender)
     VALUES ($1, $2, $3, $4, $5, $6, 'FEMALE')`,
    [trip.tripId, seat, fromSeq, toSeq, rows.bookingId, rows.passengerIdBySeatLabel.get('1')],
  );
}

describe('Handgeschriebene Constraints existieren in der Datenbank (ADR 0004)', () => {
  it.each([
    ['booking', 'booking_seq_order'],
    ['booking', 'booking_code_format'],
    ['booking', 'booking_amounts_positive'],
    ['booking', 'booking_currency_format'],
    ['booking', 'booking_status_fields'],
    ['payment', 'payment_amount_positive'],
    ['payment', 'payment_currency_format'],
    ['ticket', 'ticket_checked_in_fields'],
    ['outbox', 'outbox_attempts_nonnegative'],
  ])('%s.%s', async (table, constraint) => {
    const { rows: found } = await sql.query(
      "SELECT 1 FROM pg_constraint WHERE conname = $1 AND contype = 'c' AND conrelid = $2::regclass",
      [constraint, table],
    );
    expect(found).toHaveLength(1);
  });
});

describe('Eine Belegung spiegelt ihre Buchung', () => {
  it('passt sie, wird sie angenommen', async () => {
    await expect(insertOccupation(seatId(trip, '1'), 1, 2)).resolves.toBeDefined();
    await sql.query('DELETE FROM seat_occupation WHERE booking_id = $1', [rows.bookingId]);
  });

  it('lehnt eine andere Teilstrecke als die der Buchung ab', async () => {
    const error = await failure(insertOccupation(seatId(trip, '1'), 0, 2));
    expect(error).toMatchObject({
      code: '23503',
      constraint: 'seat_occupation_booking_id_trip_id_from_seq_to_seq_fkey',
    });
  });

  it('lehnt einen anderen Sitz als den des Fahrgasts ab, auch auf derselben Fahrt', async () => {
    const error = await failure(insertOccupation(seatId(trip, '2'), 1, 2));
    expect(error).toMatchObject({
      code: '23503',
      constraint: 'seat_occupation_booking_passenger_id_booking_id_trip_id_se_fkey',
    });
  });
});

describe('Fahrgäste, Tickets und Zahlungen gehören zu Fahrt und Firma ihrer Buchung', () => {
  it('ein Fahrgast sitzt nur auf einem Sitz der Fahrt seiner Buchung', async () => {
    const error = await failure(
      sql.query(
        `INSERT INTO booking_passenger (booking_id, trip_id, seat_id, full_name) VALUES ($1, $2, $3, 'x')`,
        [rows.bookingId, trip.tripId, seatId(other, '2')],
      ),
    );
    expect(error.code).toBe('23503');
  });

  it('ein Ticket trägt Fahrt und Firma seiner Buchung', async () => {
    const error = await failure(
      sql.query(
        `INSERT INTO ticket (booking_passenger_id, booking_id, trip_id, company_id, seat_label, updated_at)
         VALUES ($1, $2, $3, $4, '1', now())`,
        [rows.passengerIdBySeatLabel.get('1'), rows.bookingId, trip.tripId, other.companyId],
      ),
    );
    expect(error).toMatchObject({
      code: '23503',
      constraint: 'ticket_booking_id_trip_id_company_id_fkey',
    });
  });

  it('eine Zahlung gehört zur Firma ihrer Buchung', async () => {
    const error = await failure(
      sql.query(
        `INSERT INTO payment (booking_id, company_id, provider, status, amount_minor, currency, updated_at)
         VALUES ($1, $2, 'CASH', 'SUCCEEDED', 100, 'SYP', now())`,
        [rows.bookingId, other.companyId],
      ),
    );
    expect(error).toMatchObject({
      code: '23503',
      constraint: 'payment_booking_id_company_id_fkey',
    });
  });
});

describe('Status und Pflichtfelder hängen zusammen', () => {
  it.each([
    ['RESERVED ohne Barfrist', "status = 'RESERVED'"],
    ['CONFIRMED ohne Zeitpunkt', "status = 'CONFIRMED', payment_method = 'CASH'"],
    ['CANCELLED ohne Zeitpunkt und Auslöser', "status = 'CANCELLED'"],
    ['EXPIRED ohne Zeitpunkt', "status = 'EXPIRED'"],
    ['HELD ohne Ablauf', 'hold_expires_at = NULL'],
  ])('lehnt ab: %s', async (_name, assignment) => {
    const error = await failure(
      sql.query(`UPDATE booking SET ${assignment} WHERE id = $1`, [rows.bookingId]),
    );
    expect(error).toMatchObject({ code: '23514', constraint: 'booking_status_fields' });
  });

  it('lehnt einen Buchungscode außerhalb des Alphabets ab', async () => {
    const error = await failure(
      sql.query("UPDATE booking SET booking_code = 'ABCDEFGI' WHERE id = $1", [rows.bookingId]),
    );
    expect(error).toMatchObject({ code: '23514', constraint: 'booking_code_format' });
  });

  it('lässt eine Buchung nicht doppelt mit demselben Idempotenz-Schlüssel entstehen', async () => {
    const key = randomUUID();
    await insertBookingRows(prisma, trip, ['3'], { fromSeq: 0, toSeq: 1 }, 'FEMALE').then(
      ({ bookingId }) =>
        sql.query('UPDATE booking SET idempotency_key = $1 WHERE id = $2', [key, bookingId]),
    );
    const second = await insertBookingRows(prisma, trip, ['4'], { fromSeq: 0, toSeq: 1 }, 'FEMALE');
    const error = await failure(
      sql.query('UPDATE booking SET idempotency_key = $1 WHERE id = $2', [key, second.bookingId]),
    );
    expect(error).toMatchObject({ code: '23505', constraint: 'booking_idempotency_key_key' });
  });
});
