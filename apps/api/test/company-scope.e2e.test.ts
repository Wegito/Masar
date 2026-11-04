import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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
 * Status von Mitgliedschaft und Firma im `CompanyRoleGuard`: Eine deaktivierte Mitgliedschaft und
 * eine gesperrte Firma sperren eine laufende Sitzung sofort für alle Firmenrouten, lesend und
 * schreibend. `GET /auth/me` listet die Firma dann nicht mehr. Beide Zustände entstehen heute nur
 * im Betrieb direkt in der Datenbank; der Test setzt sie deshalb über Prisma.
 */

interface MeBody {
  user: { memberships: { companyId: string; role: string }[] };
}

describe('Mitgliedschafts- und Firmenstatus im CompanyRoleGuard (Integration)', () => {
  let t: TestApp;

  beforeAll(async () => {
    await resetDatabase();
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.app.close();
  });

  beforeEach(() => {
    t.resetRateLimits();
  });

  async function agentSession(): Promise<{ cookie: string; userId: string; companyId: string }> {
    const company = await createCompany(t.prisma, `firma-${randomUUID().slice(0, 8)}`);
    const email = `agent-${randomUUID()}@firma.example`;
    const user = await createStaff(t.prisma, {
      email,
      password: PASSWORD,
      memberships: [{ companyId: company.id, role: 'AGENT' }],
    });
    const cookie = await loginAs(t, email);
    return { cookie, userId: user.id, companyId: company.id };
  }

  /** Lesende Firmenroute. */
  function readRoute(companyId: string, cookie: string) {
    return t.http().get(`/api/v1/companies/${companyId}/bookings`).set('Cookie', cookie);
  }

  /**
   * Schreibende Firmenroute mit absichtlich leerem Body: Lässt der Guard durch, antwortet die
   * Validierung mit 400; sperrt er, kommt 403 vor jeder Validierung.
   */
  function writeRoute(companyId: string, cookie: string) {
    return t
      .http()
      .post(`/api/v1/companies/${companyId}/counter/quote`)
      .set('Cookie', cookie)
      .send({});
  }

  async function listedCompanies(cookie: string): Promise<string[]> {
    const res = await t.http().get('/api/v1/auth/me').set('Cookie', cookie).expect(200);
    return (res.body as MeBody).user.memberships.map((membership) => membership.companyId);
  }

  it('aktive Mitgliedschaft in aktiver Firma: lesen 200, schreiben erreicht die Validierung', async () => {
    const { cookie, companyId } = await agentSession();
    await readRoute(companyId, cookie).expect(200);
    const write = await writeRoute(companyId, cookie);
    expect(write.status).toBe(400);
    expect(await listedCompanies(cookie)).toEqual([companyId]);
  });

  it('deaktivierte Mitgliedschaft: lesen und schreiben ergeben 403 FORBIDDEN, /auth/me ohne Firma', async () => {
    const { cookie, userId, companyId } = await agentSession();
    await readRoute(companyId, cookie).expect(200);

    await t.prisma.companyMember.update({
      where: { companyId_userId: { companyId, userId } },
      data: { status: 'DISABLED' },
    });

    const read = await readRoute(companyId, cookie);
    expect(read.status).toBe(403);
    expect(read.body).toMatchObject({ code: 'FORBIDDEN' });
    const write = await writeRoute(companyId, cookie);
    expect(write.status).toBe(403);
    expect(write.body).toMatchObject({ code: 'FORBIDDEN' });
    expect(await listedCompanies(cookie)).toEqual([]);
  });

  it('gesperrte Firma bei aktiver Mitgliedschaft: lesen und schreiben ergeben 403 FORBIDDEN, /auth/me ohne Firma', async () => {
    const { cookie, userId, companyId } = await agentSession();

    // Erst deaktivieren und wieder aktivieren: Danach gilt allein der Firmenstatus.
    await t.prisma.companyMember.update({
      where: { companyId_userId: { companyId, userId } },
      data: { status: 'DISABLED' },
    });
    await t.prisma.companyMember.update({
      where: { companyId_userId: { companyId, userId } },
      data: { status: 'ACTIVE' },
    });
    await readRoute(companyId, cookie).expect(200);

    await t.prisma.company.update({ where: { id: companyId }, data: { status: 'SUSPENDED' } });

    const read = await readRoute(companyId, cookie);
    expect(read.status).toBe(403);
    expect(read.body).toMatchObject({ code: 'FORBIDDEN' });
    const write = await writeRoute(companyId, cookie);
    expect(write.status).toBe(403);
    expect(write.body).toMatchObject({ code: 'FORBIDDEN' });
    expect(await listedCompanies(cookie)).toEqual([]);
  });
});
