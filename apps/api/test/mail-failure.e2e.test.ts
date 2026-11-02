import { Writable } from 'node:stream';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AuthService } from '../src/modules/auth/auth.service.js';
import {
  createCompany,
  createStaff,
  createTestApp,
  loginAs,
  PASSWORD,
  resetDatabase,
  type TestApp,
} from './helpers/app.js';

const INVITEE = 'neu.lina@firma-a.example';
const STAFF = 'agent@firma-a.example';

/** SMTP-Fehler, wie nodemailer sie meldet: Adresse und Name stecken in Meldung und Antwort. */
function smtpRejection(to: string): Error {
  return Object.assign(new Error(`550 5.1.1 <${to}>: Postfach von Lina Haddad voll`), {
    code: 'EENVELOPE',
    response: `550 5.1.1 <${to}>`,
  });
}

/**
 * Prüft die echte Log-Ausgabe, wenn der Versand scheitert: Nur Fehlerklasse und Code dürfen
 * erscheinen, weder die Empfängeradresse noch sonst etwas aus der Meldung des Mailservers.
 */
describe('Log bei gescheitertem Mailversand (Integration)', () => {
  let t: TestApp;
  const lines: string[] = [];

  beforeAll(async () => {
    const logs = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    t = await createTestApp({ logs });
    t.mailer.send = (message) => Promise.reject(smtpRejection(message.to));
  });

  afterAll(async () => {
    await t.app.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    t.resetRateLimits();
    lines.length = 0;
  });

  const logged = (msg: string): Record<string, unknown> | undefined =>
    lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((entry) => entry['msg'] === msg);

  it('Einladung: meldet emailDelivered=false und loggt nur Fehlerklasse und Code', async () => {
    const companyId = (await createCompany(t.prisma, 'firma-a')).id;
    await createStaff(t.prisma, {
      email: 'admin@firma-a.example',
      password: PASSWORD,
      memberships: [{ companyId, role: 'ADMIN' }],
    });
    const admin = await loginAs(t, 'admin@firma-a.example');
    const res = await t
      .http()
      .post(`/api/v1/companies/${companyId}/invitations`)
      .set('Cookie', admin)
      .send({ email: INVITEE, role: 'AGENT' })
      .expect(201);
    expect(res.body).toMatchObject({ emailDelivered: false });

    expect(logged('Einladung nicht zugestellt')).toMatchObject({
      error: { type: 'Error', code: 'EENVELOPE' },
    });
    const text = lines.join('');
    for (const secret of [INVITEE, 'neu.lina', 'Lina', 'Haddad', '550 5.1.1']) {
      expect(text).not.toContain(secret);
    }
  });

  it('Passwort-Reset: loggt nur Fehlerklasse und Code', async () => {
    await createStaff(t.prisma, { email: STAFF, password: PASSWORD });
    await t.http().post('/api/v1/auth/password-reset/request').send({ email: STAFF }).expect(202);
    await t.app.get(AuthService).settled();

    expect(logged('Mail für Passwort-Reset nicht zugestellt')).toMatchObject({
      error: { type: 'Error', code: 'EENVELOPE' },
    });
    const text = lines.join('');
    for (const secret of [STAFF, 'Lina', 'Haddad', '550 5.1.1']) {
      expect(text).not.toContain(secret);
    }
  });
});
