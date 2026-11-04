/**
 * Cursor der Fahrtenliste im Portal (Keyset-Paginierung, Schritt 2.4). Reine Funktionen ohne Ein-
 * und Ausgabe. Sortiert wird nach Abfahrt am Starthalt, dann nach Fahrt-ID; der Cursor ist der
 * Schlüssel des letzten Eintrags, base64url-kodiert und für Clients opak.
 */

export interface TripListCursor {
  departureAt: Date;
  tripId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_CURSOR_LENGTH = 200;

export function encodeTripListCursor(cursor: TripListCursor): string {
  const key = [cursor.departureAt.toISOString(), cursor.tripId];
  return Buffer.from(JSON.stringify(key), 'utf8').toString('base64url');
}

/** `null`, wenn der Cursor nicht von {@link encodeTripListCursor} stammen kann. */
export function decodeTripListCursor(value: string): TripListCursor | null {
  if (value.length === 0 || value.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(value)) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) {
    return null;
  }
  const [departure, tripId] = parsed as unknown[];
  if (typeof departure !== 'string' || typeof tripId !== 'string' || !UUID.test(tripId)) {
    return null;
  }
  const departureAt = new Date(departure);
  if (Number.isNaN(departureAt.getTime()) || departureAt.toISOString() !== departure) {
    return null;
  }
  return { departureAt, tripId };
}
