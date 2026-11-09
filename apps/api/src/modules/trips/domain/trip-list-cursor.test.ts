import { describe, expect, it } from 'vitest';

import { decodeTripListCursor, encodeTripListCursor } from './trip-list-cursor.js';

describe('Cursor der Fahrtenliste', () => {
  const cursor = {
    departureAt: new Date('2026-11-10T04:00:00.000Z'),
    tripId: '0199f7a4-5c2e-7d3a-9b1e-2f4c6a8d0e12',
  };

  it('kodiert und dekodiert den Schlüssel des letzten Eintrags', () => {
    expect(decodeTripListCursor(encodeTripListCursor(cursor))).toEqual(cursor);
  });

  it('weist fremde oder kaputte Werte zurück', () => {
    expect(decodeTripListCursor('')).toBeNull();
    expect(decodeTripListCursor('kein base64!')).toBeNull();
    expect(decodeTripListCursor(Buffer.from('["x","y"]').toString('base64url'))).toBeNull();
    expect(
      decodeTripListCursor(
        Buffer.from(JSON.stringify(['2026-11-10', cursor.tripId])).toString('base64url'),
      ),
    ).toBeNull();
  });
});
