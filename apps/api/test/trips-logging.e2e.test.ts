import { Writable } from 'node:stream';

import { localDateInDamascus } from '@masar/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { damascusDayRange } from '../src/modules/trips/domain/search-day.js';
import { createTestApp, type TestApp } from './helpers/app.js';
import { createSearchFixture, createSearchTrip } from './helpers/search.js';

/**
 * Eigene Datei, weil nestjs-pino den Logger der ersten Anwendung einer Datei weiterverwendet:
 * Eine zweite Anwendung mit umgeleiteter Ausgabe schriebe sonst nicht in den Puffer.
 */

function inThreeDaysAt8(): Date {
  const day = localDateInDamascus(new Date(Date.now() + 3 * 24 * 3_600_000));
  return new Date(damascusDayRange(day).start.getTime() + 8 * 3_600_000);
}

describe('Log-Ausgabe von Suche und Sitzplan', () => {
  let t: TestApp;
  const lines: string[] = [];

  beforeAll(async () => {
    const capture = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    t = await createTestApp({ logs: capture });
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('enthält weder die Geschlechter aus dem Body noch Query-Parameter', async () => {
    const fixture = await createSearchFixture(t.prisma);
    const departureAt = inThreeDaysAt8();
    const trip = await createSearchTrip(t.prisma, fixture, { departureAt });
    await t
      .http()
      .post(`/api/v1/trips/${trip.tripId}/seat-map`)
      .send({
        fromStopId: trip.tripStopIds[0],
        toStopId: trip.tripStopIds[3],
        genders: ['FEMALE', 'MALE'],
      })
      .expect(200);
    await t
      .http()
      .get('/api/v1/trips/search')
      .query({
        from: fixture.cityIds[0],
        to: fixture.cityIds[3],
        date: localDateInDamascus(departureAt),
      })
      .expect(200);

    // pino-http schreibt beim Abschluss der Antwort, also womöglich erst nach supertest.
    for (let i = 0; i < 50 && !lines.join('').includes('/api/v1/trips/search'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const log = lines.join('');
    expect(log).toContain('/api/v1/trips/search');
    expect(log).toContain('/seat-map');
    expect(log).not.toMatch(/FEMALE|MALE|genders/);
    expect(log).not.toContain(fixture.cityIds[0]!);
    expect(log).not.toContain(trip.tripStopIds[0]!);
  });
});
