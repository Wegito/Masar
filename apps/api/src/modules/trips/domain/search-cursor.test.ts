import { describe, expect, it } from 'vitest';

import { decodeSearchCursor, encodeSearchCursor } from './search-cursor.js';

const CURSOR = {
  departureAt: new Date('2026-11-03T20:00:00.000Z'),
  tripId: '0199f7a4-5c2e-7d3a-9b1e-2f4c6a8d0e12',
  fromStopId: '0199f7a4-5c2e-7d3a-9b1e-2f4c6a8d0e13',
  toStopId: '0199f7a4-5c2e-7d3a-9b1e-2f4c6a8d0e14',
};

describe('Such-Cursor', () => {
  it('übersteht Kodieren und Dekodieren und ist URL-sicher', () => {
    const encoded = encodeSearchCursor(CURSOR);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeSearchCursor(encoded)).toEqual(CURSOR);
  });

  it.each([
    ['leer', ''],
    ['kein base64url', 'a+b/c='],
    ['kein JSON', Buffer.from('{').toString('base64url')],
    ['falsche Form', Buffer.from('{"a":1}').toString('base64url')],
    ['falsche Länge', Buffer.from('["x"]').toString('base64url')],
    [
      'keine UUID',
      Buffer.from(JSON.stringify(['2026-11-03T20:00:00.000Z', 'x', 'y', 'z'])).toString(
        'base64url',
      ),
    ],
    [
      'kein Zeitpunkt',
      Buffer.from(
        JSON.stringify(['gestern', CURSOR.tripId, CURSOR.fromStopId, CURSOR.toStopId]),
      ).toString('base64url'),
    ],
    ['zu lang', 'a'.repeat(301)],
  ])('lehnt ab: %s', (_name, value) => {
    expect(decodeSearchCursor(value)).toBeNull();
  });
});
