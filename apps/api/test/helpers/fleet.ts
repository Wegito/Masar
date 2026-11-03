import type pg from 'pg';

import type { PrismaClient } from '../../src/generated/prisma/client.js';

/**
 * Bausteine für Tests der Flotte (Schritt 2.2). Eine Fahrt entsteht hier ohne Halte und Kontingent:
 * Für die Regel „ein genutzter Sitzplan ist unveränderlich" zählt nur, dass eine Fahrt auf Plan
 * und Bus verweist. Die Fahrtplanung selbst kommt mit Schritt 2.4.
 */

let counter = 0;

/** Route mit Stornoregel, ohne Halte. */
export async function createBareRoute(prisma: PrismaClient, companyId: string): Promise<string> {
  counter += 1;
  const policy = await prisma.cancellationPolicy.create({
    data: { companyId, name: `Test ${counter}` },
    select: { id: true },
  });
  const route = await prisma.route.create({
    data: {
      companyId,
      cancellationPolicyId: policy.id,
      nameAr: `خط ${counter}`,
      nameEn: `Line ${counter}`,
    },
    select: { id: true },
  });
  return route.id;
}

/** SQL einer Fahrt im Entwurf; `$1` Firma, `$2` Route, `$3` Sitzplan, `$4` Bus oder NULL. */
const INSERT_TRIP = `
  INSERT INTO trip (company_id, route_id, seat_layout_id, bus_id, service_date, departure_at,
                    arrival_at, online_sales_close_at, gender_rule_enabled, updated_at)
  VALUES ($1, $2, $3, $4, current_date + 3, now() + interval '3 days',
          now() + interval '3 days 4 hours', now() + interval '3 days' - interval '30 minutes',
          true, now())
  RETURNING id`;

export interface TripRef {
  companyId: string;
  routeId: string;
  seatLayoutId: string;
  busId?: string | null;
}

/** Fahrt per SQL mit der Anwendungsrolle, an der Anwendung vorbei. */
export async function insertTrip(client: pg.Client, ref: TripRef): Promise<string> {
  const result = await client.query<{ id: string }>(INSERT_TRIP, [
    ref.companyId,
    ref.routeId,
    ref.seatLayoutId,
    ref.busId ?? null,
  ]);
  return result.rows[0]!.id;
}
