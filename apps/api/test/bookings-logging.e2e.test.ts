import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';

import { formatBookingCode } from '@masar/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BookingExpiryJob } from '../src/modules/bookings/booking-expiry.job.js';
import { OutboxWorker } from '../src/modules/outbox/outbox.worker.js';
import {
  createStaff,
  createTestApp,
  loginAs,
  PASSWORD,
  resetDatabase,
  type TestApp,
} from './helpers/app.js';
import { createBookableTrip, guestPost, hold } from './helpers/bookings.js';

/**
 * Log-Ausgabe des Buchungskerns (Definition of Done: keine Personendaten im neuen Pfad). Eigene
 * Datei, weil nestjs-pino den Logger der ersten Anwendung einer Datei weiterverwendet.
 */
describe('Log-Ausgabe des Buchungskerns', () => {
  let t: TestApp;
  const lines: string[] = [];

  beforeAll(async () => {
    // Leere Outbox: Sonst holt der Durchgang unten (höchstens 20 Einträge, älteste zuerst) liegen
    // gebliebene Einträge einer vorher gelaufenen Datei statt der eigenen ab.
    await resetDatabase();
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

  it('enthält weder Namen, Telefon, E-Mail, Ausweisnummer, Geschlecht, Buchungscode noch Tokens', async () => {
    // Auch die Ticketseite: Code und Telefon aus der Suche, Lese- und QR-Tokens (Schritt 1.4).
    const bookable = await createBookableTrip(t.prisma, {
      company: { requireNationalId: true },
      commissionRateBps: 300,
    });
    const email = `zeynab-${randomUUID()}@example.com`;
    const phone = '+963933456789';
    const name = 'Zeynab Al-Khatib';
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
      memberships: [{ companyId: bookable.fixture.companyId, role: 'AGENT' }],
    });
    const cookie = await loginAs(t, staffEmail);
    await t
      .http()
      .post(`/api/v1/companies/${bookable.fixture.companyId}/bookings/lookup`)
      .set('Cookie', cookie)
      .send({ bookingCode: booking.bookingCode })
      .expect(200);
    await t
      .http()
      .post(`/api/v1/companies/${bookable.fixture.companyId}/bookings/${booking.id}/confirm-cash`)
      .set('Cookie', cookie)
      .expect(200);

    // Ticketseite (Schritt 1.4): Suche mit Code und Telefon, falsches Telefon, Abruf der QR-Tokens.
    // Ein ersetzter QR-Hash erzeugt eine eigene Logzeile.
    await t
      .http()
      .post('/api/v1/bookings/lookup')
      .send({ bookingCode: formatBookingCode(booking.bookingCode), phone: '+963933456780' })
      .expect(404);
    await t.prisma.ticket.updateMany({
      where: { bookingId: booking.id },
      data: { qrTokenHash: randomUUID() },
    });
    const found = await t
      .http()
      .post('/api/v1/bookings/lookup')
      .send({ bookingCode: booking.bookingCode, phone })
      .expect(200);
    const { accessToken } = found.body as { accessToken: string };
    const page = await t
      .http()
      .get(`/api/v1/bookings/${booking.id}/ticket`)
      .set('X-Manage-Token', accessToken)
      .expect(200);
    const qrTokens = (page.body as { tickets: { qrToken: string }[] }).tickets.map(
      (ticket) => ticket.qrToken,
    );
    expect(qrTokens).toHaveLength(1);

    // Ablauf eines zweiten Holds und eine fehlschlagende Zustellung erzeugen Logzeilen der Jobs.
    const other = await hold(t, bookable, {
      passengers: [{ label: '5A', gender: 'FEMALE', fullName: name, nationalId }],
      name,
      phone,
    });
    t.clock.advance(16 * 60_000);
    await t.app.get(BookingExpiryJob).runOnce();
    const send = t.mailer.send.bind(t.mailer);
    t.mailer.send = () =>
      Promise.reject(
        Object.assign(new Error(`550 no such user <${email}> ${phone}`), { code: 'EENVELOPE' }),
      );
    try {
      await t.app.get(OutboxWorker).runOnce();
    } finally {
      t.mailer.send = send;
    }

    for (let i = 0; i < 50 && !lines.join('').includes('confirm-cash'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const log = lines.join('');
    // Die Pfade und die Jobs erscheinen, sonst wäre der Test wertlos.
    expect(log).toContain('/api/v1/bookings');
    expect(log).toContain('/confirm-cash');
    expect(log).toContain('Abgelaufene Buchungen freigegeben');
    expect(log).toContain('Outbox-Eintrag wird wiederholt');
    expect(log).toContain('/api/v1/bookings/lookup');
    expect(log).toContain('QR-Hash eines Tickets ersetzt');
    expect(log).toContain(bookable.trip.tripId);

    for (const secret of [
      name,
      'Zeynab',
      phone,
      phone.slice(4),
      email,
      nationalId,
      booking.bookingCode,
      formatBookingCode(booking.bookingCode),
      other.bookingCode,
      booking.manageToken,
      other.manageToken,
      accessToken,
      ...qrTokens,
      '933456780',
    ]) {
      expect(log, secret.slice(0, 3)).not.toContain(secret);
    }
    expect(log).not.toMatch(/FEMALE/);
  });
});
