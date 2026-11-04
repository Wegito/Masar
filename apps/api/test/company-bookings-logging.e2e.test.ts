import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';

import { formatBookingCode } from '@masar/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createStaff, createTestApp, loginAs, PASSWORD, type TestApp } from './helpers/app.js';
import { createBookableTrip, guestPost, hold } from './helpers/bookings.js';

/**
 * Log-Ausgabe der Buchungen im Portal (Schritt 2.5, Definition of Done: keine Personendaten im
 * neuen Pfad). Der Suchtext steht in der Query (ADR 0028); geloggt wird nur der Pfad. Eigene
 * Datei, weil nestjs-pino den Logger der ersten Anwendung einer Datei weiterverwendet.
 */
describe('Log-Ausgabe der Buchungen im Portal', () => {
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

  it('enthält weder Suchtext, Namen, Telefon, E-Mail, Ausweisnummer, Geschlecht noch Codes', async () => {
    const bookable = await createBookableTrip(t.prisma, {
      company: { requireNationalId: true },
      commissionRateBps: 300,
    });
    const companyId = bookable.fixture.companyId;
    const name = 'Zeynab Al-Khatib';
    const phone = '+963933456789';
    const email = `zeynab-${randomUUID()}@example.com`;
    const nationalId = '01020304050';
    const booking = await hold(t, bookable, {
      passengers: [{ label: '1A', gender: 'FEMALE', fullName: name, nationalId }],
      name,
      phone,
      email,
    });
    await guestPost(t, booking, 'reserve-cash').expect(200);

    const staffEmail = `agent-${randomUUID()}@firma.example`;
    await createStaff(t.prisma, {
      email: staffEmail,
      password: PASSWORD,
      memberships: [{ companyId, role: 'AGENT' }],
    });
    const cookie = await loginAs(t, staffEmail);
    const base = `/api/v1/companies/${companyId}`;
    // Suche nach Telefon-Ende und Code-Anfang, ungültige Suche mit Namen, Detail, Kontakt,
    // Bestätigung und Fahrgastliste.
    await t.http().get(`${base}/bookings`).query({ q: '456789' }).set('Cookie', cookie).expect(200);
    await t
      .http()
      .get(`${base}/bookings`)
      .query({ q: booking.bookingCode.slice(0, 6) })
      .set('Cookie', cookie)
      .expect(200);
    await t.http().get(`${base}/bookings`).query({ q: name }).set('Cookie', cookie).expect(400);
    await t.http().get(`${base}/bookings/${booking.id}`).set('Cookie', cookie).expect(200);
    const contact = await t
      .http()
      .post(`${base}/bookings/${booking.id}/reveal-contact`)
      .set('Cookie', cookie)
      .expect(200);
    expect(contact.body).toEqual({ phone, email });
    await t
      .http()
      .post(`${base}/bookings/${booking.id}/confirm-cash`)
      .set('Cookie', cookie)
      .expect(200);
    await t
      .http()
      .get(`${base}/trips/${bookable.trip.tripId}/passengers`)
      .set('Cookie', cookie)
      .expect(200);

    for (let i = 0; i < 50 && !lines.join('').includes('/passengers'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const log = lines.join('');
    // Die Pfade erscheinen, sonst wäre der Test wertlos.
    expect(log).toContain(`${base}/bookings`);
    expect(log).toContain('/reveal-contact');
    expect(log).toContain('/passengers');

    for (const secret of [
      name,
      'Zeynab',
      phone,
      phone.slice(4),
      '456789',
      email,
      nationalId,
      nationalId.slice(-4),
      booking.bookingCode,
      booking.bookingCode.slice(0, 6),
      formatBookingCode(booking.bookingCode),
      booking.manageToken,
    ]) {
      expect(log, secret.slice(0, 3)).not.toContain(secret);
    }
    expect(log).not.toMatch(/FEMALE/);
    expect(log).not.toMatch(/[?&]q=/);
  });
});
