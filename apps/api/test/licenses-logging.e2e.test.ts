import { Writable } from 'node:stream';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createCompany,
  createStaff,
  createTestApp,
  loginAs,
  PASSWORD,
  resetDatabase,
  type TestApp,
} from './helpers/app.js';

/**
 * Log-Ausgabe der Lizenzpflege (Schritt 2.7). Eigene Datei, weil nestjs-pino den Logger der ersten
 * Anwendung einer Datei weiterverwendet. Die interne Notiz des Plattform-Admins könnte trotz Hinweis
 * Personendaten enthalten; sie darf weder im Log noch im Audit-Log stehen, ebenso keine E-Mail.
 */
describe('Log-Ausgabe der Lizenzpflege', () => {
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
    await resetDatabase();
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('enthält weder Notiz noch Kontaktdaten, nur IDs', async () => {
    const companyId = (await createCompany(t.prisma, 'lizenz-log')).id;
    await createStaff(t.prisma, {
      email: 'betrieb-log@masar.example',
      password: PASSWORD,
      isPlatformAdmin: true,
    });
    const cookie = await loginAs(t, 'betrieb-log@masar.example');
    const notes = 'Lina Haddad 0933123456';
    const created = await t
      .http()
      .post(`/api/v1/admin/companies/${companyId}/license`)
      .set('Cookie', cookie)
      .send({ plan: 'ONE_YEAR', busPackages: 2, notes });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    await t
      .http()
      .put(`/api/v1/admin/companies/${companyId}/license`)
      .set('Cookie', cookie)
      .send({ busPackages: 3, notes: `${notes} neu` })
      .expect(200);

    for (let i = 0; i < 50 && !lines.join('').includes('Lizenzzeitraum geändert'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const log = lines.join('');
    expect(log).toContain('Lizenzzeitraum angelegt');
    expect(log).toContain('Lizenzzeitraum geändert');
    expect(log).toContain(companyId);
    expect(log).not.toContain('Lina');
    expect(log).not.toContain('Haddad');
    expect(log).not.toMatch(/0933123456|933123456/);
    expect(log).not.toContain('betrieb-log@masar.example');

    const audit = await t.prisma.auditLog.findMany({ where: { entityType: 'company_license' } });
    expect(audit).toHaveLength(2);
    expect(JSON.stringify(audit)).not.toMatch(/Lina|Haddad|0933123456/);
  });
});
