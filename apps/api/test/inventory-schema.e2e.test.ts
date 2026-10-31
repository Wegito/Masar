import { randomUUID } from 'node:crypto';

import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaClient } from '../src/generated/prisma/client.js';
import { generateSeatLayout } from '../src/modules/fleet/domain/seat-layout.js';
import { insertSeatLayout } from '../src/modules/fleet/seat-layout.repository.js';
import { resetDatabase } from './helpers/app.js';
import { createInventoryFixture, type InventoryFixture, seatId } from './helpers/inventory.js';

/**
 * Datenbankregeln des Inventars (ADR 0004, 0005, 0007). Alle Schreibzugriffe laufen hier absichtlich
 * an der Anwendung vorbei, direkt per SQL mit der Anwendungsrolle. So verhält sich ein künftiger
 * Schreibpfad, der die Trip-Sperre vergisst; die Datenbank muss ihn trotzdem aufhalten.
 */

const APP_DATABASE_URL = process.env.DATABASE_URL as string;

interface PgError {
  code: string;
  constraint?: string;
}

async function connect(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: APP_DATABASE_URL });
  await client.connect();
  return client;
}

async function failure(promise: Promise<unknown>): Promise<PgError> {
  try {
    await promise;
  } catch (error) {
    return error as PgError;
  }
  throw new Error('Die Anweisung hätte scheitern müssen');
}

function occupy(
  client: pg.Client,
  fixture: InventoryFixture,
  label: string,
  fromSeq: number,
  toSeq: number,
): Promise<pg.QueryResult> {
  return occupySeat(client, fixture.tripId, seatId(fixture, label), fromSeq, toSeq);
}

function occupySeat(
  client: pg.Client,
  tripId: string,
  seat: string,
  fromSeq: number,
  toSeq: number,
): Promise<pg.QueryResult> {
  return client.query(
    `INSERT INTO seat_occupation (trip_id, seat_id, from_seq, to_seq, booking_id, booking_passenger_id, gender)
     VALUES ($1, $2, $3, $4, $5, $6, 'FEMALE')`,
    [tripId, seat, fromSeq, toSeq, randomUUID(), randomUUID()],
  );
}

/** Wartet, bis die Verbindung `pid` auf eine Sperre wartet (statt mit einer festen Pause zu raten). */
async function waitUntilBlocked(observer: pg.Client, pid: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const { rows } = await observer.query<{ wait_event_type: string | null }>(
      'SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1',
      [pid],
    );
    if (rows[0]?.wait_event_type === 'Lock') {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Verbindung ${pid} wartet nicht auf eine Sperre`);
}

let prisma: PrismaClient;
let sql: pg.Client;
let trip: InventoryFixture;
let otherCompany: InventoryFixture;

beforeAll(async () => {
  await resetDatabase();
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: APP_DATABASE_URL }) });
  trip = await createInventoryFixture(prisma);
  otherCompany = await createInventoryFixture(prisma);
  sql = await connect();
});

afterAll(async () => {
  await sql.end();
  await prisma.$disconnect();
});

describe('Handgeschriebene Constraints existieren in der Datenbank (ADR 0004)', () => {
  it.each([
    ['seat_occupation', 'seat_occupation_no_overlap', 'x'],
    ['seat_occupation', 'seat_occupation_seq_order', 'c'],
    ['fare', 'fare_no_overlap', 'x'],
    ['fare', 'fare_distinct_stops', 'c'],
    ['fare', 'fare_amount_positive', 'c'],
    ['fare', 'fare_currency_format', 'c'],
    ['fare', 'fare_validity_order', 'c'],
    ['route_stop', 'route_stop_seq_nonnegative', 'c'],
    ['trip_stop', 'trip_stop_seq_nonnegative', 'c'],
    ['trip_stop', 'trip_stop_has_time', 'c'],
    ['trip_stop', 'trip_stop_time_order', 'c'],
    ['trip', 'trip_time_order', 'c'],
    ['trip', 'trip_sales_close_not_after_departure', 'c'],
    ['trip', 'trip_cash_deadline_not_after_departure', 'c'],
    ['seat', 'seat_position_nonnegative', 'c'],
    ['seat_neighbor', 'seat_neighbor_not_self', 'c'],
    ['seat_layout', 'seat_layout_version_positive', 'c'],
  ])('%s.%s', async (table, constraint, type) => {
    const { rows } = await sql.query(
      'SELECT 1 FROM pg_constraint WHERE conname = $1 AND contype = $2 AND conrelid = $3::regclass',
      [constraint, type, table],
    );
    expect(rows).toHaveLength(1);
  });
});

describe('Sitzbelegung: kein Sitz doppelt auf überlappenden Teilstrecken (ADR 0005)', () => {
  it('lehnt eine Überlappung ab: [0,2) und [1,3) auf demselben Sitz', async () => {
    await occupy(sql, trip, '1', 0, 2);
    const error = await failure(occupy(sql, trip, '1', 1, 3));
    expect(error).toMatchObject({ code: '23P01', constraint: 'seat_occupation_no_overlap' });
  });

  it('erlaubt angrenzende Teilstrecken: der Sitz wird am Ausstiegshalt frei', async () => {
    await occupy(sql, trip, '2', 0, 1);
    await expect(occupy(sql, trip, '2', 1, 3)).resolves.toBeDefined();
  });

  it('erlaubt denselben Sitz auf derselben Teilstrecke einer anderen Fahrt', async () => {
    await occupy(sql, trip, '3', 0, 3);
    await expect(occupy(sql, otherCompany, '3', 0, 3)).resolves.toBeDefined();
  });

  it('lehnt eine leere oder umgekehrte Teilstrecke ab', async () => {
    const error = await failure(occupy(sql, trip, '4', 2, 2));
    expect(error).toMatchObject({ code: '23514', constraint: 'seat_occupation_seq_order' });
  });

  it('lehnt eine Teilstrecke über den letzten Halt hinaus ab', async () => {
    const error = await failure(occupy(sql, trip, '4', 2, 4));
    expect(error.code).toBe('23503');
  });

  it('lehnt einen Sitz ab, der nicht zum Sitzplan der Fahrt gehört', async () => {
    const foreignSeat = seatId(otherCompany, '5');
    const error = await failure(occupySeat(sql, trip.tripId, foreignSeat, 0, 1));
    expect(error).toMatchObject({
      code: '23503',
      constraint: 'seat_occupation_trip_id_seat_id_fkey',
    });
  });

  it('verhindert, dass sich Teilstrecken bestehender Belegungen durch neue Positionen verschieben', async () => {
    await occupy(sql, trip, '6', 0, 1);
    const error = await failure(
      sql.query('UPDATE trip_stop SET seq = 9 WHERE trip_id = $1 AND seq = 0', [trip.tripId]),
    );
    // ON UPDATE RESTRICT meldet restrict_violation (23001), nicht foreign_key_violation (23503).
    expect(error).toMatchObject({
      code: '23001',
      constraint: 'seat_occupation_trip_id_from_seq_fkey',
    });
  });
});

describe('Sitzbelegung unter Nebenläufigkeit (zwei echte Verbindungen)', () => {
  it('lässt von zwei gleichzeitigen, überlappenden Belegungen genau eine gewinnen', async () => {
    const first = await connect();
    const second = await connect();
    try {
      await first.query('BEGIN');
      await second.query('BEGIN');
      await occupy(first, trip, '7', 0, 2);
      // Die zweite Verbindung sieht die noch nicht festgeschriebene Zeile nicht, wartet aber auf sie.
      const pending = failure(occupy(second, trip, '7', 1, 3));
      await waitUntilBlocked(sql, (second as unknown as { processID: number }).processID);
      await first.query('COMMIT');
      expect(await pending).toMatchObject({ code: '23P01' });
      await second.query('ROLLBACK');
    } finally {
      await first.end();
      await second.end();
    }
    const { rows } = await sql.query(
      'SELECT count(*)::int AS n FROM seat_occupation WHERE trip_id = $1 AND seat_id = $2',
      [trip.tripId, seatId(trip, '7')],
    );
    expect(rows[0]).toEqual({ n: 1 });
  });

  it('gibt den Sitz frei, wenn die erste Transaktion zurückrollt', async () => {
    const first = await connect();
    const second = await connect();
    try {
      await first.query('BEGIN');
      await second.query('BEGIN');
      await occupy(first, trip, '8', 0, 2);
      const pending = occupy(second, trip, '8', 1, 3);
      await waitUntilBlocked(sql, (second as unknown as { processID: number }).processID);
      await first.query('ROLLBACK');
      await expect(pending).resolves.toBeDefined();
      await second.query('COMMIT');
    } finally {
      await first.end();
      await second.end();
    }
  });
});

describe('Firmen und Sitzpläne bleiben getrennt', () => {
  it('eine Fahrt kann keine Route einer anderen Firma nutzen', async () => {
    const error = await failure(
      sql.query('UPDATE trip SET route_id = $1 WHERE id = $2', [otherCompany.routeId, trip.tripId]),
    );
    expect(error).toMatchObject({ code: '23503', constraint: 'trip_route_id_company_id_fkey' });
  });

  it('eine Fahrt kann keinen Bus mit anderem Sitzplan nutzen, auch nicht in derselben Firma', async () => {
    const otherLayout = await prisma.$transaction((tx) =>
      insertSeatLayout(tx, {
        companyId: trip.companyId,
        name: `Anderes Layout ${randomUUID().slice(0, 8)}`,
        blueprint: generateSeatLayout({ pattern: 'TWO_PLUS_ONE', rows: 1, rearBench: false }),
      }),
    );
    const bus = await prisma.bus.create({
      data: {
        companyId: trip.companyId,
        plate: `T-${randomUUID().slice(0, 6)}`,
        seatLayoutId: otherLayout.layoutId,
      },
      select: { id: true },
    });
    const error = await failure(
      sql.query('UPDATE trip SET bus_id = $1 WHERE id = $2', [bus.id, trip.tripId]),
    );
    expect(error).toMatchObject({
      code: '23503',
      constraint: 'trip_bus_id_company_id_seat_layout_id_fkey',
    });
  });

  it('das Kontingent einer Fahrt enthält nur Sitze aus ihrem Sitzplan', async () => {
    const foreignSeat = seatId(otherCompany, '1');
    const sameLayoutClaim = await failure(
      sql.query(
        'INSERT INTO trip_seat (trip_id, seat_layout_id, seat_id, online_sellable, updated_at) VALUES ($1, $2, $3, true, now())',
        [trip.tripId, trip.layoutId, foreignSeat],
      ),
    );
    expect(sameLayoutClaim.code).toBe('23503');
    const foreignLayoutClaim = await failure(
      sql.query(
        'INSERT INTO trip_seat (trip_id, seat_layout_id, seat_id, online_sellable, updated_at) VALUES ($1, $2, $3, true, now())',
        [trip.tripId, otherCompany.layoutId, foreignSeat],
      ),
    );
    expect(foreignLayoutClaim).toMatchObject({
      code: '23503',
      constraint: 'trip_seat_trip_id_seat_layout_id_fkey',
    });
  });

  it('Nachbarpaare liegen im selben Sitzplan, und kein Sitz ist sein eigener Nachbar', async () => {
    const insertNeighbor = (seat: string, neighbor: string) =>
      sql.query(
        'INSERT INTO seat_neighbor (layout_id, seat_id, neighbor_seat_id) VALUES ($1, $2, $3)',
        [trip.layoutId, seat, neighbor],
      );
    expect(await failure(insertNeighbor(seatId(trip, '1'), seatId(trip, '1')))).toMatchObject({
      code: '23514',
      constraint: 'seat_neighbor_not_self',
    });
    expect((await failure(insertNeighbor(seatId(trip, '1'), seatId(otherCompany, '2')))).code).toBe(
      '23503',
    );
  });
});

describe('Tarife: höchstens ein Preis je Haltestellenpaar und Fahrtag', () => {
  function insertFare(
    fixture: InventoryFixture,
    from: number,
    to: number,
    validFrom: string,
    validUntil: string | null,
    overrides: { amount?: number; currency?: string; fromStop?: string } = {},
  ): Promise<pg.QueryResult> {
    return sql.query(
      `INSERT INTO fare (route_id, from_route_stop_id, to_route_stop_id, amount_minor, currency, valid_from, valid_until, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
      [
        fixture.routeId,
        overrides.fromStop ?? fixture.routeStopIds[from],
        fixture.routeStopIds[to],
        overrides.amount ?? 2_500_000,
        overrides.currency ?? 'SYP',
        validFrom,
        validUntil,
      ],
    );
  }

  it('lehnt einen zweiten Tarif mit überlappendem Zeitraum ab', async () => {
    await insertFare(trip, 0, 3, '2026-01-01', null);
    const error = await failure(insertFare(trip, 0, 3, '2026-06-01', '2026-07-01'));
    expect(error).toMatchObject({ code: '23P01', constraint: 'fare_no_overlap' });
  });

  it('erlaubt aufeinanderfolgende Zeiträume (halboffen) und andere Paare', async () => {
    await insertFare(trip, 0, 1, '2026-01-01', '2026-02-01');
    await expect(insertFare(trip, 0, 1, '2026-02-01', null)).resolves.toBeDefined();
    await expect(insertFare(trip, 1, 3, '2026-01-01', null)).resolves.toBeDefined();
  });

  it('lehnt Halte einer anderen Route ab', async () => {
    const error = await failure(
      insertFare(trip, 0, 2, '2026-01-01', null, { fromStop: otherCompany.routeStopIds[0] }),
    );
    expect(error.code).toBe('23503');
  });

  it.each([
    ['Betrag 0', { amount: 0 }, 'fare_amount_positive'],
    ['Währung klein geschrieben', { currency: 'syp' }, 'fare_currency_format'],
  ])('lehnt ab: %s', async (_name, overrides, constraint) => {
    const error = await failure(insertFare(trip, 1, 2, '2027-01-01', null, overrides));
    expect(error).toMatchObject({ code: '23514', constraint });
  });

  it('lehnt gleiche Halte und ein Ende vor dem Beginn ab', async () => {
    expect(await failure(insertFare(trip, 2, 2, '2027-01-01', null))).toMatchObject({
      code: '23514',
      constraint: 'fare_distinct_stops',
    });
    expect(await failure(insertFare(trip, 2, 3, '2027-01-01', '2027-01-01'))).toMatchObject({
      code: '23514',
      constraint: 'fare_validity_order',
    });
  });
});

describe('Fahrtzeiten', () => {
  it.each([
    ['Ankunft nicht nach der Abfahrt', 'arrival_at = departure_at', 'trip_time_order'],
    [
      'Online-Verkauf endet nach der Abfahrt',
      "online_sales_close_at = departure_at + interval '1 minute'",
      'trip_sales_close_not_after_departure',
    ],
    [
      'Barfrist nach der Abfahrt',
      "cash_deadline_at = departure_at + interval '1 minute'",
      'trip_cash_deadline_not_after_departure',
    ],
  ])('lehnt ab: %s', async (_name, assignment, constraint) => {
    const error = await failure(
      sql.query(`UPDATE trip SET ${assignment} WHERE id = $1`, [trip.tripId]),
    );
    expect(error).toMatchObject({ code: '23514', constraint });
  });
});
