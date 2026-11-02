/**
 * Cursor der Suchergebnisse (Keyset-Paginierung). Reine Funktionen ohne Ein- und Ausgabe.
 *
 * Sortiert wird nach Abfahrt am Einstiegshalt, dann nach Fahrt, Einstiegs- und Ausstiegshalt.
 * Der Cursor ist der Sortierschlüssel des letzten Treffers, base64url-kodiert. Er ist für Clients
 * opak und enthält keine personenbezogenen Daten.
 */

export interface SearchCursor {
  departureAt: Date;
  tripId: string;
  fromStopId: string;
  toStopId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_CURSOR_LENGTH = 300;

export function encodeSearchCursor(cursor: SearchCursor): string {
  const key = [cursor.departureAt.toISOString(), cursor.tripId, cursor.fromStopId, cursor.toStopId];
  return Buffer.from(JSON.stringify(key), 'utf8').toString('base64url');
}

/** `null`, wenn der Cursor nicht von {@link encodeSearchCursor} stammen kann. */
export function decodeSearchCursor(value: string): SearchCursor | null {
  if (value.length === 0 || value.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(value)) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 4) {
    return null;
  }
  const [departure, tripId, fromStopId, toStopId] = parsed as unknown[];
  if (
    typeof departure !== 'string' ||
    ![tripId, fromStopId, toStopId].every((id) => typeof id === 'string' && UUID.test(id))
  ) {
    return null;
  }
  const departureAt = new Date(departure);
  if (Number.isNaN(departureAt.getTime()) || departureAt.toISOString() !== departure) {
    return null;
  }
  return {
    departureAt,
    tripId: tripId as string,
    fromStopId: fromStopId as string,
    toStopId: toStopId as string,
  };
}
