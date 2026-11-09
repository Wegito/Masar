import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';

import { formatBookingCode } from '@masar/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createStaff, createTestApp, loginAs, PASSWORD, type TestApp } from './helpers/app.js';
import { bookingBody, createBookableTrip } from './helpers/bookings.js';

/**
 * Log-Ausgabe des Schaltermodus (Schritt 2.6, Definition of Done: keine Personendaten im neuen
 * Pfad). Eigene Datei, weil nestjs-pino den Logger der ersten Anwendung einer Datei weiterverwendet.
 */
describe('Log-Ausgabe des Schaltermodus', () => {
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

  it('enthält weder Name, Telefon, E-Mail, Ausweisnummer, Geschlecht, Code noch QR-Token', async () => {
    // Ohne Provisionssatz: Der Service schreibt dann eine Warnung, die ebenfalls geprüft wird.
    const bookable = await createBookableTrip(t.prisma, { company: { requireNationalId: true } });
    const companyId = bookable.fixture.companyId;
    const name = 'Zeynab Al-Khatib';
    const phone = '+963933456789';
    const email = `zeynab-${randomUUID()}@example.com`;
    const nationalId = '01020304050';
    const staffEmail = `agent-${randomUUID()}@firma.example`;
    await createStaff(t.prisma, {
      email: staffEmail,
      password: PASSWORD,
      memberships: [{ companyId, role: 'AGENT' }],
    });
    const cookie = await loginAs(t, staffEmail);
    const base = `/api/v1/companies/${companyId}`;

    await t
      .http()
      .get(`${base}/trips/${bookable.trip.tripId}/counter-seat-map`)
      .set('Cookie', cookie)
      .expect(200);
    await t
      .http()
      .post(`${base}/counter/quote`)
      .set('Cookie', cookie)
      .send({
        tripId: bookable.trip.tripId,
        fromStopId: bookable.trip.tripStopIds[0],
        toStopId: bookable.trip.tripStopIds[3],
        seats: [{ seatId: bookable.trip.seatIdByLabel.get('1A'), gender: 'FEMALE' }],
      })
      .expect(200);
    const sale = await t
      .http()
      .post(`${base}/counter/sales`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send(
        bookingBody(bookable, {
          passengers: [{ label: '1A', gender: 'FEMALE', fullName: name, nationalId }],
          name,
          phone,
          email,
        }),
      )
      .expect(201);
    const booking = (sale.body as { booking: { id: string; bookingCode: string } }).booking;
    // Abgelehnter Verkauf (Sitz belegt) läuft durch den Fehlerpfad.
    await t
      .http()
      .post(`${base}/counter/sales`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send(
        bookingBody(bookable, {
          passengers: [{ label: '1A', gender: 'FEMALE', fullName: name, nationalId }],
          name,
          phone,
        }),
      )
      .expect(409);
    const ticket = await t
      .http()
      .get(`${base}/bookings/${booking.id}/ticket`)
      .set('Cookie', cookie)
      .expect(200);
    const qrToken = (ticket.body as { tickets: { qrToken: string }[] }).tickets[0]!.qrToken;

    for (let i = 0; i < 50 && !lines.join('').includes('/ticket'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const log = lines.join('');
    expect(log).toContain('/counter/sales');
    expect(log).toContain('/counter-seat-map');
    expect(log).toContain('/ticket');
    expect(log).toContain('Schalterverkauf mit 0 bps');

    for (const secret of [
      name,
      'Zeynab',
      phone,
      phone.slice(4),
      email,
      nationalId,
      nationalId.slice(-4),
      booking.bookingCode,
      formatBookingCode(booking.bookingCode),
      qrToken,
    ]) {
      expect(log, secret.slice(0, 3)).not.toContain(secret);
    }
    expect(log).not.toMatch(/FEMALE/);
  });
});
