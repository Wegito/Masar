import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../src/generated/prisma/client.js';
import { resetDatabase } from './helpers/app.js';
import {
  backendPid,
  connectRaw,
  createAppPrisma,
  createHeldBooking,
  createTripFixture,
  insertBookingRaw,
  insertOccupation,
  randomBookingCode,
  seatId,
  sqlError,
  type TripFixture,
  waitUntilBlocked,
} from './helpers/inventory.js';

/**
 * Sitzinventar, Invarianten und Mandantentrennung in der Datenbank (Schritt 1.1, ADR 0004, 0005,
 * 0018). Alle Schreibzugriffe gehen absichtlich an der Anwendung vorbei: Geprüft wird, was die
 * Datenbank selbst erzwingt, auch wenn ein Schreibpfad die Trip-Sperre vergisst.
 */

const EXCLUSION_CONSTRAINTS = [
  ['seat_occupation', 'seat_occupation_no_overlap'],
  ['fare', 'fare_no_overlap'],
  ['commission_rate', 'commission_rate_no_overlap'],
] as const;

const CHECK_CONSTRAINTS = [
  ['seat_occupation', 'seat_occupation_seq_order'],
  ['fare', 'fare_amount_nonnegative'],
  ['fare', 'fare_currency_format'],
  ['fare', 'fare_valid_range'],
  ['fare', 'fare_distinct_stops'],
  ['commission_rate', 'commission_rate_range'],
  ['commission_rate', 'commission_rate_valid_range'],
  ['booking', 'booking_seq_order'],
  ['booking', 'booking_amounts_nonnegative'],
  ['booking', 'booking_currency_format'],
  ['booking', 'booking_commission_rate_range'],
  ['booking', 'booking_code_format'],
  ['booking', 'booking_held_has_expiry'],
  ['booking', 'booking_confirmed_has_timestamp'],
  ['booking', 'booking_cancelled_has_timestamp'],
  ['booking', 'booking_contact_email_normalized'],
  ['booking_passenger', 'booking_passenger_national_id_complete'],
  ['booking_passenger', 'booking_passenger_national_id_last4'],
  ['payment', 'payment_amount_nonnegative'],
  ['payment', 'payment_currency_format'],
  ['payment', 'payment_fx_complete'],
  ['payment', 'payment_fx_rate_positive'],
  ['refund', 'refund_amount_positive'],
  ['refund', 'refund_currency_format'],
  ['trip', 'trip_arrival_after_departure'],
  ['trip', 'trip_sales_close_before_departure'],
  ['trip', 'trip_cash_deadline_before_departure'],
  ['trip', 'trip_version_nonnegative'],
  ['trip_stop', 'trip_stop_seq_nonnegative'],
  ['trip_stop', 'trip_stop_times_order'],
  ['route_stop', 'route_stop_seq_nonnegative'],
  ['seat_layout', 'seat_layout_version_positive'],
  ['seat', 'seat_position_nonnegative'],
  ['seat', 'seat_label_not_blank'],
  ['seat_neighbor', 'seat_neighbor_not_self'],
  ['station', 'station_coordinates'],
  ['cancellation_policy_rule', 'cancellation_policy_rule_minutes_nonnegative'],
  ['cancellation_policy_rule', 'cancellation_policy_rule_fee_range'],
  ['ticket', 'ticket_checked_in_has_timestamp'],
  ['commission_statement', 'commission_statement_period_format'],
  ['commission_statement', 'commission_statement_currency_format'],
  ['outbox', 'outbox_attempts_nonnegative'],
  ['notification', 'notification_has_recipient'],
] as const;

describe('Sitzinventar und Invarianten in der Datenbank', () => {
  let prisma: PrismaClient;
  let raw: pg.Client;
  let fixture: TripFixture;

  beforeAll(async () => {
    await resetDatabase();
    prisma = createAppPrisma();
    raw = await connectRaw();
    fixture = await createTripFixture(prisma);
  });

  afterAll(async () => {
    await raw.end();
    await prisma.$disconnect();
  });

  describe('handgeschriebene Migration', () => {
    it('btree_gist ist installiert (Grundlage der EXCLUDE-Constraints)', async () => {
      const { rows } = await raw.query(
        `SELECT extname FROM pg_extension WHERE extname = 'btree_gist'`,
      );
      expect(rows).toEqual([{ extname: 'btree_gist' }]);
    });

    it.each(EXCLUSION_CONSTRAINTS)('%s hat das EXCLUDE-Constraint %s', async (table, name) => {
      const { rows } = await raw.query<{ contype: string; def: string }>(
        `SELECT contype, pg_get_constraintdef(oid) AS def
           FROM pg_constraint WHERE conname = $1 AND conrelid = $2::regclass`,
        [name, table],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.contype).toBe('x');
      expect(rows[0]?.def).toMatch(/^EXCLUDE USING gist/);
    });

    it('seat_occupation_no_overlap vergleicht halboffene Bereiche je Fahrt und Sitz', async () => {
      const { rows } = await raw.query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conname = 'seat_occupation_no_overlap'`,
      );
      expect(rows[0]?.def).toBe(
        "EXCLUDE USING gist (trip_id WITH =, seat_id WITH =, int4range(from_seq, to_seq, '[)'::text) WITH &&)",
      );
    });

    it('alle CHECK-Constraints existieren', async () => {
      const { rows } = await raw.query<{ tbl: string; name: string }>(
        `SELECT conrelid::regclass::text AS tbl, conname AS name
           FROM pg_constraint WHERE contype = 'c' AND connamespace = 'public'::regnamespace`,
      );
      const existing = new Set(rows.map((row) => `${row.tbl}.${row.name}`));
      const missing = CHECK_CONSTRAINTS.map(([table, name]) => `${table}.${name}`).filter(
        (entry) => !existing.has(entry),
      );
      expect(missing).toEqual([]);
    });

    it('die Anwendungsrolle darf Historie nicht löschen, Belegungen aber schon', async () => {
      const { rows } = await raw.query<{ tbl: string; del: boolean; upd: boolean }>(
        `SELECT t AS tbl,
                has_table_privilege('masar_app', t, 'DELETE') AS del,
                has_table_privilege('masar_app', t, 'UPDATE') AS upd
           FROM unnest($1::text[]) AS t`,
        [
          [
            'booking',
            'booking_passenger',
            'ticket',
            'payment',
            'refund',
            'payment_webhook_event',
            'seat_occupation',
            'outbox',
          ],
        ],
      );
      expect(
        Object.fromEntries(rows.map((row) => [row.tbl, { del: row.del, upd: row.upd }])),
      ).toEqual({
        booking: { del: false, upd: true },
        booking_passenger: { del: false, upd: true },
        ticket: { del: false, upd: true },
        payment: { del: false, upd: true },
        refund: { del: false, upd: true },
        payment_webhook_event: { del: false, upd: true },
        seat_occupation: { del: true, upd: true },
        outbox: { del: true, upd: true },
      });
    });
  });

  describe('Überlappung von Teilstrecken (halboffen)', () => {
    it('[0,2) und [2,4) auf demselben Sitz sind erlaubt, [0,3) dazu nicht (23P01)', async () => {
      const seat = seatId(fixture, '1A');
      const first = await createHeldBooking(prisma, fixture, {
        fromSeq: 0,
        toSeq: 2,
        seats: ['1A'],
      });
      const second = await createHeldBooking(prisma, fixture, {
        fromSeq: 2,
        toSeq: 4,
        seats: ['1A'],
      });
      const third = await createHeldBooking(prisma, fixture, {
        fromSeq: 0,
        toSeq: 3,
        seats: ['1A'],
      });
      const occupation = (booking: typeof first, fromSeq: number, toSeq: number) => ({
        tripId: fixture.tripId,
        seatId: seat,
        fromSeq,
        toSeq,
        bookingId: booking.bookingId,
        passengerId: booking.passengerIds[0]!,
      });

      await insertOccupation(raw, occupation(first, 0, 2));
      await insertOccupation(raw, occupation(second, 2, 4));
      expect(await sqlError(insertOccupation(raw, occupation(third, 0, 3)))).toEqual({
        code: '23P01',
        constraint: 'seat_occupation_no_overlap',
      });
    });

    it('dieselbe Teilstrecke auf einem anderen Sitz ist erlaubt', async () => {
      const a = await createHeldBooking(prisma, fixture, { fromSeq: 0, toSeq: 3, seats: ['5A'] });
      const b = await createHeldBooking(prisma, fixture, { fromSeq: 0, toSeq: 3, seats: ['5B'] });
      for (const [booking, label] of [
        [a, '5A'],
        [b, '5B'],
      ] as const) {
        await insertOccupation(raw, {
          tripId: fixture.tripId,
          seatId: seatId(fixture, label),
          fromSeq: 0,
          toSeq: 3,
          bookingId: booking.bookingId,
          passengerId: booking.passengerIds[0]!,
        });
      }
      const { rows } = await raw.query(
        `SELECT 1 FROM seat_occupation WHERE trip_id = $1 AND seat_id = ANY($2::uuid[])`,
        [fixture.tripId, [seatId(fixture, '5A'), seatId(fixture, '5B')]],
      );
      expect(rows).toHaveLength(2);
    });

    it('nach dem Löschen der Belegung (Storno) ist der Sitz wieder frei', async () => {
      const a = await createHeldBooking(prisma, fixture, { fromSeq: 1, toSeq: 3, seats: ['6A'] });
      const b = await createHeldBooking(prisma, fixture, { fromSeq: 0, toSeq: 4, seats: ['6A'] });
      const occ = (booking: typeof a, fromSeq: number, toSeq: number) => ({
        tripId: fixture.tripId,
        seatId: seatId(fixture, '6A'),
        fromSeq,
        toSeq,
        bookingId: booking.bookingId,
        passengerId: booking.passengerIds[0]!,
      });
      await insertOccupation(raw, occ(a, 1, 3));
      expect((await sqlError(insertOccupation(raw, occ(b, 0, 4)))).code).toBe('23P01');
      await raw.query('DELETE FROM seat_occupation WHERE booking_id = $1', [a.bookingId]);
      await insertOccupation(raw, occ(b, 0, 4));
    });
  });

  describe('CHECK-Constraints', () => {
    it.each([
      ['booking_seq_order', 'to_seq = from_seq'],
      ['booking_amounts_nonnegative', 'total_amount_minor = -1'],
      ['booking_currency_format', "currency = 'syp'"],
      ['booking_code_format', "booking_code = 'ABCDEFGI'"],
      ['booking_held_has_expiry', 'hold_expires_at = NULL'],
      ['booking_confirmed_has_timestamp', "status = 'CONFIRMED'"],
      ['booking_contact_email_normalized', "contact_email = 'Gast@Example.com'"],
    ])('%s lehnt "%s" ab (23514)', async (constraint, assignment) => {
      const { bookingId } = await createHeldBooking(prisma, fixture, {
        fromSeq: 0,
        toSeq: 1,
        seats: ['10D'],
      });
      expect(
        await sqlError(raw.query(`UPDATE booking SET ${assignment} WHERE id = $1`, [bookingId])),
      ).toEqual({ code: '23514', constraint });
    });

    it('Ausweis-Chiffrat nur zusammen mit der Schlüssel-ID', async () => {
      const { passengerIds } = await createHeldBooking(prisma, fixture, {
        fromSeq: 0,
        toSeq: 1,
        seats: ['10C'],
      });
      expect(
        await sqlError(
          raw.query(
            `UPDATE booking_passenger SET national_id_encrypted = '\\x00'::bytea WHERE id = $1`,
            [passengerIds[0]],
          ),
        ),
      ).toEqual({ code: '23514', constraint: 'booking_passenger_national_id_complete' });
    });

    it('je Haltestellenpaar höchstens ein gültiger Tarif pro Tag (fare_no_overlap)', async () => {
      const [from, to] = [fixture.routeStopIds[0]!, fixture.routeStopIds[3]!];
      const insertFare = (validFrom: string, validUntil: string | null) =>
        raw.query(
          `INSERT INTO fare (route_id, from_route_stop_id, to_route_stop_id, amount_minor, currency,
                             valid_from, valid_until, updated_at)
           VALUES ($1, $2, $3, 60000, 'SYP', $4, $5, now())`,
          [fixture.routeId, from, to, validFrom, validUntil],
        );
      await insertFare('2026-01-01', '2026-07-01');
      // Anschließend ab dem Ende des ersten Zeitraums: erlaubt (halboffen).
      await insertFare('2026-07-01', null);
      expect(await sqlError(insertFare('2026-06-30', '2026-07-02'))).toEqual({
        code: '23P01',
        constraint: 'fare_no_overlap',
      });
    });
  });

  describe('Nebenläufigkeit mit zwei echten Verbindungen', () => {
    let first: pg.Client;
    let second: pg.Client;

    beforeAll(async () => {
      first = await connectRaw();
      second = await connectRaw();
    });

    afterAll(async () => {
      await first.end();
      await second.end();
    });

    it('ohne Sperre wartet die zweite Belegung auf die erste und scheitert dann mit 23P01', async () => {
      const a = await createHeldBooking(prisma, fixture, { fromSeq: 0, toSeq: 2, seats: ['2A'] });
      const b = await createHeldBooking(prisma, fixture, { fromSeq: 1, toSeq: 3, seats: ['2A'] });
      const seat = seatId(fixture, '2A');

      await first.query('BEGIN');
      await second.query('BEGIN');
      try {
        await insertOccupation(first, {
          tripId: fixture.tripId,
          seatId: seat,
          fromSeq: 0,
          toSeq: 2,
          bookingId: a.bookingId,
          passengerId: a.passengerIds[0]!,
        });
        // Die zweite Transaktion sieht die erste noch nicht, muss aber auf ihr Ergebnis warten.
        const pending = sqlError(
          insertOccupation(second, {
            tripId: fixture.tripId,
            seatId: seat,
            fromSeq: 1,
            toSeq: 3,
            bookingId: b.bookingId,
            passengerId: b.passengerIds[0]!,
          }),
        );
        await waitUntilBlocked(raw, await backendPid(second));
        await first.query('COMMIT');
        expect(await pending).toEqual({ code: '23P01', constraint: 'seat_occupation_no_overlap' });
      } finally {
        await second.query('ROLLBACK');
        await first.query('ROLLBACK').catch(() => undefined);
      }

      const { rows } = await raw.query<{ booking_id: string }>(
        'SELECT booking_id FROM seat_occupation WHERE trip_id = $1 AND seat_id = $2',
        [fixture.tripId, seat],
      );
      expect(rows).toEqual([{ booking_id: a.bookingId }]);
    });

    it('Trip-Sperre, frisch lesen, prüfen, schreiben: genau eine von zwei Buchungen bekommt den Sitz', async () => {
      const seat = seatId(fixture, '3A');
      const bookings = [
        await createHeldBooking(prisma, fixture, { fromSeq: 0, toSeq: 3, seats: ['3A'] }),
        await createHeldBooking(prisma, fixture, { fromSeq: 2, toSeq: 4, seats: ['3A'] }),
      ];
      const segments = [
        [0, 3],
        [2, 4],
      ] as const;

      // Ablauf wie im Buchungsservice (domaenenmodell.md, kritische Transaktion), in SQL.
      async function reserve(client: pg.Client, index: 0 | 1): Promise<'RESERVED' | 'SEAT_TAKEN'> {
        const booking = bookings[index]!;
        const [fromSeq, toSeq] = segments[index];
        await client.query('BEGIN');
        try {
          await client.query('SELECT id FROM trip WHERE id = $1 FOR UPDATE', [fixture.tripId]);
          const { rows } = await client.query(
            `SELECT 1 FROM seat_occupation
              WHERE trip_id = $1 AND seat_id = $2
                AND int4range(from_seq, to_seq, '[)') && int4range($3, $4, '[)')`,
            [fixture.tripId, seat, fromSeq, toSeq],
          );
          if (rows.length > 0) {
            await client.query('ROLLBACK');
            return 'SEAT_TAKEN';
          }
          await insertOccupation(client, {
            tripId: fixture.tripId,
            seatId: seat,
            fromSeq,
            toSeq,
            bookingId: booking.bookingId,
            passengerId: booking.passengerIds[0]!,
          });
          await client.query('COMMIT');
          return 'RESERVED';
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      }

      // Die erste Verbindung hält die Sperre, bis die zweite nachweislich wartet.
      await first.query('BEGIN');
      await first.query('SELECT id FROM trip WHERE id = $1 FOR UPDATE', [fixture.tripId]);
      const secondResult = reserve(second, 1);
      await waitUntilBlocked(raw, await backendPid(second));
      await first.query('COMMIT');
      const firstResult = reserve(first, 0);

      const results = await Promise.all([firstResult, secondResult]);
      expect([...results].sort()).toEqual(['RESERVED', 'SEAT_TAKEN']);
      const { rows } = await raw.query(
        'SELECT 1 FROM seat_occupation WHERE trip_id = $1 AND seat_id = $2',
        [fixture.tripId, seat],
      );
      expect(rows).toHaveLength(1);
    });
  });

  describe('Mandantentrennung und Zusammenhalt über zusammengesetzte Fremdschlüssel', () => {
    let foreign: TripFixture;

    beforeAll(async () => {
      foreign = await createTripFixture(prisma);
    });

    it('eine Buchung der Firma B auf die Fahrt der Firma A scheitert (23503)', async () => {
      expect(
        await sqlError(
          insertBookingRaw(raw, {
            companyId: foreign.companyId,
            tripId: fixture.tripId,
            fromTripStopId: fixture.tripStopIds[0]!,
            toTripStopId: fixture.tripStopIds[1]!,
            fromSeq: 0,
            toSeq: 1,
          }),
        ),
      ).toEqual({ code: '23503', constraint: 'booking_trip_id_company_id_fkey' });
    });

    it('auch über Prisma lässt sich keine Buchung auf eine fremde Fahrt anlegen', async () => {
      await expect(
        prisma.booking.create({
          data: {
            companyId: foreign.companyId,
            tripId: fixture.tripId,
            bookingCode: randomBookingCode(),
            status: 'HELD',
            channel: 'ONLINE',
            fromTripStopId: fixture.tripStopIds[0]!,
            toTripStopId: fixture.tripStopIds[1]!,
            fromSeq: 0,
            toSeq: 1,
            contactName: 'Test Passenger',
            contactPhoneE164: '+963900000000',
            holdExpiresAt: new Date(Date.now() + 60_000),
            fareAmountMinor: 1,
            totalAmountMinor: 1,
            currency: 'SYP',
          },
        }),
      ).rejects.toThrow(/foreign key/i);
    });

    it('die Positionen einer Buchung müssen zu ihren Fahrthalten passen', async () => {
      expect(
        await sqlError(
          insertBookingRaw(raw, {
            companyId: fixture.companyId,
            tripId: fixture.tripId,
            fromTripStopId: fixture.tripStopIds[0]!,
            toTripStopId: fixture.tripStopIds[1]!,
            fromSeq: 0,
            toSeq: 2,
          }),
        ),
      ).toEqual({ code: '23503', constraint: 'booking_to_trip_stop_id_trip_id_to_seq_fkey' });
    });

    it('Halte einer fremden Fahrt sind nicht verwendbar', async () => {
      expect(
        (
          await sqlError(
            insertBookingRaw(raw, {
              companyId: fixture.companyId,
              tripId: fixture.tripId,
              fromTripStopId: foreign.tripStopIds[0]!,
              toTripStopId: fixture.tripStopIds[1]!,
              fromSeq: 0,
              toSeq: 1,
            }),
          )
        ).code,
      ).toBe('23503');
    });

    it('Zahlung und Ticket nur mit der Firma der Buchung', async () => {
      const { bookingId, passengerIds } = await createHeldBooking(prisma, fixture, {
        fromSeq: 0,
        toSeq: 1,
        seats: ['7A'],
      });
      expect(
        await sqlError(
          raw.query(
            `INSERT INTO payment (booking_id, company_id, method, amount_minor, currency,
                                  idempotency_key, updated_at)
             VALUES ($1, $2, 'CASH', 25000, 'SYP', $3, now())`,
            [bookingId, foreign.companyId, `test-${bookingId}`],
          ),
        ),
      ).toEqual({ code: '23503', constraint: 'payment_booking_id_company_id_fkey' });
      expect(
        await sqlError(
          raw.query(
            `INSERT INTO ticket (booking_passenger_id, booking_id, trip_id, company_id, seat_label,
                                 qr_token_hash, updated_at)
             VALUES ($1, $2, $3, $4, '7A', $5, now())`,
            [passengerIds[0], bookingId, fixture.tripId, foreign.companyId, `hash-${bookingId}`],
          ),
        ),
      ).toEqual({ code: '23503', constraint: 'ticket_trip_id_company_id_fkey' });
    });

    it('ein Sitz eines anderen Sitzplans gehört nicht ins Kontingent der Fahrt', async () => {
      expect(
        await sqlError(
          raw.query(
            `INSERT INTO trip_seat (trip_id, seat_id, seat_layout_id, online_sellable, updated_at)
             VALUES ($1, $2, $3, true, now())`,
            [fixture.tripId, seatId(foreign, '1A'), fixture.seatLayoutId],
          ),
        ),
      ).toEqual({ code: '23503', constraint: 'trip_seat_seat_id_seat_layout_id_fkey' });
    });

    it('eine Belegung muss die Teilstrecke ihrer Buchung haben', async () => {
      const booking = await createHeldBooking(prisma, fixture, {
        fromSeq: 0,
        toSeq: 2,
        seats: ['8A'],
      });
      expect(
        await sqlError(
          insertOccupation(raw, {
            tripId: fixture.tripId,
            seatId: seatId(fixture, '8A'),
            fromSeq: 0,
            toSeq: 1,
            bookingId: booking.bookingId,
            passengerId: booking.passengerIds[0]!,
          }),
        ),
      ).toEqual({
        code: '23503',
        constraint: 'seat_occupation_booking_id_trip_id_from_seq_to_seq_fkey',
      });
    });

    it('der Sitzplan einer Fahrt mit Kontingent lässt sich nicht austauschen', async () => {
      const other = await prisma.seatLayout.create({
        data: {
          companyId: fixture.companyId,
          name: `other-${fixture.tripId}`,
          pattern: 'TWO_PLUS_ONE',
        },
        select: { id: true },
      });
      const { code, constraint } = await sqlError(
        raw.query('UPDATE trip SET seat_layout_id = $1 WHERE id = $2', [other.id, fixture.tripId]),
      );
      expect(code).toBe('23503');
      expect(constraint).toBe('trip_seat_trip_id_seat_layout_id_fkey');
    });
  });
});
