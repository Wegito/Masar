import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, resetDatabase, type TestApp } from './helpers/app.js';
import { createInventoryFixture, seatId } from './helpers/inventory.js';

/**
 * Echte Log-Ausgabe des Buchungswegs (AGENTS.md, Personenbezogene Daten): Telefonnummer, Name,
 * Geschlecht, Buchungscode und Token dürfen nie im Log stehen. Eigene Datei, weil nestjs-pino seinen
 * Logger statisch hält und eine zweite App in derselben Datei nicht in den Mitschnitt schreibt.
 */
describe('Log-Ausgabe des Buchungswegs', () => {
  let testApp: TestApp;
  const lines: string[] = [];
  let bookingCode = '';
  let token = '';

  beforeAll(async () => {
    const logs = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    testApp = await createTestApp({ logs });
    await resetDatabase();
    const fixture = await createInventoryFixture(testApp.prisma, { withFares: true });
    const res = await testApp
      .http()
      .post('/api/v1/bookings')
      .set('Idempotency-Key', randomUUID())
      .send({
        tripId: fixture.tripId,
        fromSeq: 0,
        toSeq: 3,
        contact: { name: 'Rania Unverwechselbar', phone: '0966 777 888' },
        passengers: [
          { seatId: seatId(fixture, '1'), fullName: 'Samir Unverwechselbar', gender: 'MALE' },
        ],
      })
      .expect(201);
    ({ bookingCode, manageToken: token } = res.body as {
      bookingCode: string;
      manageToken: string;
    });
    await testApp.http().get('/api/v1/my-booking').set('X-Booking-Token', token).expect(200);
    await testApp
      .http()
      .post('/api/v1/my-booking/cash')
      .set('X-Booking-Token', token)
      .send()
      .expect(200);
    await testApp
      .http()
      .post('/api/v1/my-booking/cancel')
      .set('X-Booking-Token', token)
      .send()
      .expect(200);
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  it('hat den Buchungsweg überhaupt geloggt (sonst wäre der Test wertlos)', () => {
    const output = lines.join('');
    expect(output).toContain('/api/v1/bookings');
    expect(output).toContain('/api/v1/my-booking/cancel');
  });

  it('enthält weder Telefonnummer, Namen, Geschlecht, Buchungscode noch Token', () => {
    const output = lines.join('');
    for (const secret of ['966777888', 'Unverwechselbar', 'MALE', bookingCode, token]) {
      expect(output).not.toContain(secret);
    }
  });
});
