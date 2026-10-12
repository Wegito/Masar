import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createCompany,
  createStaff,
  createTestApp,
  FOREIGN_PASSWORD,
  loginAs,
  PASSWORD,
  resetDatabase,
  sessionCookie,
  type TestApp,
} from './helpers/app.js';

const NEW_EMAIL = 'neu@firma-a.example';

describe('Einladungen und Mandantentrennung (Integration)', () => {
  let t: TestApp;
  let companyA: string;
  let companyB: string;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.app.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    t.mailer.sent.length = 0;
    t.resetRateLimits();
    companyA = (await createCompany(t.prisma, 'firma-a')).id;
    companyB = (await createCompany(t.prisma, 'firma-b')).id;
    await createStaff(t.prisma, {
      email: 'admin@firma-a.example',
      password: PASSWORD,
      memberships: [{ companyId: companyA, role: 'ADMIN' }],
    });
    await createStaff(t.prisma, {
      email: 'agent@firma-a.example',
      password: PASSWORD,
      memberships: [{ companyId: companyA, role: 'AGENT' }],
    });
    await createStaff(t.prisma, {
      email: 'admin@firma-b.example',
      password: PASSWORD,
      memberships: [{ companyId: companyB, role: 'ADMIN' }],
    });
    await createStaff(t.prisma, {
      email: 'plattform@masar.example',
      password: PASSWORD,
      isPlatformAdmin: true,
    });
  });

  const invite = (cookie: string, companyId: string, body: object) =>
    t.http().post(`/api/v1/companies/${companyId}/invitations`).set('Cookie', cookie).send(body);

  it('Firmen-Admin lädt ein; die Annahme legt Konto, Mitgliedschaft und Sitzung an', async () => {
    const admin = await loginAs(t, 'admin@firma-a.example');
    const res = await invite(admin, companyA, {
      email: 'Neu@Firma-A.example',
      role: 'AGENT',
    }).expect(201);
    expect(res.body).toMatchObject({
      invitation: { email: NEW_EMAIL, role: 'AGENT' },
      emailDelivered: true,
    });

    const mail = t.mailer.sent.at(-1);
    expect(mail?.to).toBe(NEW_EMAIL);
    expect(mail?.text).toMatch(/\/ar\/auth\/accept-invitation#token=/);
    const token = t.mailer.tokenSentTo(NEW_EMAIL);

    const accepted = await t
      .http()
      .post('/api/v1/invitations/accept')
      .send({ token, displayName: 'Lina', password: PASSWORD })
      .expect(201);
    const cookie = sessionCookie(accepted);
    const me = await t.http().get('/api/v1/auth/me').set('Cookie', cookie).expect(200);
    expect(me.body).toMatchObject({
      user: { email: NEW_EMAIL, memberships: [{ companyId: companyA, role: 'AGENT' }] },
    });
    const user = await t.prisma.user.findUniqueOrThrow({ where: { email: NEW_EMAIL } });
    expect(user.emailVerifiedAt).not.toBeNull();
  });

  it('Firma A kann nicht in Firma B einladen (Mandantentrennung)', async () => {
    const admin = await loginAs(t, 'admin@firma-a.example');
    const res = await invite(admin, companyB, { email: NEW_EMAIL, role: 'ADMIN' }).expect(403);
    expect(res.body).toMatchObject({ code: 'FORBIDDEN' });
    expect(await t.prisma.invitation.count()).toBe(0);
    expect(t.mailer.sent).toHaveLength(0);
  });

  it('Agenten dürfen nicht einladen', async () => {
    const agent = await loginAs(t, 'agent@firma-a.example');
    await invite(agent, companyA, { email: NEW_EMAIL, role: 'AGENT' }).expect(403);
  });

  it('Plattform-Admins dürfen auch ohne Mitgliedschaft einladen', async () => {
    const platform = await loginAs(t, 'plattform@masar.example');
    await invite(platform, companyB, {
      email: 'chef@firma-b.example',
      role: 'ADMIN',
      locale: 'en',
    }).expect(201);
    expect(t.mailer.sent.at(-1)?.subject).toBe('Invitation to join Company firma-b on Masar');
  });

  it('beantwortet ungültige und unbekannte Firmen-IDs ohne Hinweis auf Existenz', async () => {
    const admin = await loginAs(t, 'admin@firma-a.example');
    await invite(admin, 'keine-uuid', { email: NEW_EMAIL, role: 'AGENT' }).expect(404);
    await invite(admin, '0199f7a4-5c2e-7d3a-9b1e-2f4c6a8d0e12', {
      email: NEW_EMAIL,
      role: 'AGENT',
    }).expect(403);
  });

  it('lehnt die Einladung bestehender Mitglieder ab', async () => {
    const admin = await loginAs(t, 'admin@firma-a.example');
    const res = await invite(admin, companyA, {
      email: 'agent@firma-a.example',
      role: 'ADMIN',
    }).expect(409);
    expect(res.body).toMatchObject({ code: 'ALREADY_MEMBER' });
  });

  it('eine Einladung gilt genau einmal', async () => {
    const admin = await loginAs(t, 'admin@firma-a.example');
    await invite(admin, companyA, { email: NEW_EMAIL, role: 'AGENT' }).expect(201);
    const token = t.mailer.tokenSentTo(NEW_EMAIL);
    await t
      .http()
      .post('/api/v1/invitations/accept')
      .send({ token, displayName: 'Lina', password: PASSWORD })
      .expect(201);
    const again = await t
      .http()
      .post('/api/v1/invitations/accept')
      .send({ token, displayName: 'Lina', password: PASSWORD })
      .expect(400);
    expect(again.body).toMatchObject({ code: 'INVITATION_INVALID' });
  });

  it('eine neue Einladung macht den alten Link ungültig', async () => {
    const admin = await loginAs(t, 'admin@firma-a.example');
    await invite(admin, companyA, { email: NEW_EMAIL, role: 'AGENT' }).expect(201);
    const oldToken = t.mailer.tokenSentTo(NEW_EMAIL);
    await invite(admin, companyA, { email: NEW_EMAIL, role: 'DRIVER' }).expect(201);
    await t
      .http()
      .post('/api/v1/invitations/accept')
      .send({ token: oldToken, displayName: 'Lina', password: PASSWORD })
      .expect(400);
  });

  it('eine abgelaufene Einladung wird abgelehnt', async () => {
    const admin = await loginAs(t, 'admin@firma-a.example');
    await invite(admin, companyA, { email: NEW_EMAIL, role: 'AGENT' }).expect(201);
    const token = t.mailer.tokenSentTo(NEW_EMAIL);
    t.clock.advance(72 * 3_600_000 + 60_000);
    await t
      .http()
      .post('/api/v1/invitations/accept')
      .send({ token, displayName: 'Lina', password: PASSWORD })
      .expect(400);
  });

  it('neue Konten brauchen Name und ein Passwort mit mindestens 12 Zeichen', async () => {
    const admin = await loginAs(t, 'admin@firma-a.example');
    await invite(admin, companyA, { email: NEW_EMAIL, role: 'AGENT' }).expect(201);
    const token = t.mailer.tokenSentTo(NEW_EMAIL);
    const missing = await t.http().post('/api/v1/invitations/accept').send({ token }).expect(400);
    expect(missing.body).toMatchObject({
      code: 'VALIDATION_FAILED',
      errors: [
        { path: 'displayName', rule: 'required' },
        { path: 'password', rule: 'required' },
      ],
    });
    const short = await t
      .http()
      .post('/api/v1/invitations/accept')
      .send({ token, displayName: 'Lina', password: 'kurz' })
      .expect(400);
    expect(short.body).toMatchObject({ errors: [{ path: 'password', rule: 'too_small' }] });
  });

  it('bestehende Konten nehmen nur angemeldet als genau diese Person an; das Passwort bleibt unverändert', async () => {
    const adminB = await loginAs(t, 'admin@firma-b.example');
    await invite(adminB, companyB, { email: 'agent@firma-a.example', role: 'AGENT' }).expect(201);
    const token = t.mailer.tokenSentTo('agent@firma-a.example');

    const anonymous = await t
      .http()
      .post('/api/v1/invitations/accept')
      .send({ token, displayName: 'X', password: FOREIGN_PASSWORD })
      .expect(401);
    expect(anonymous.body).toMatchObject({ code: 'UNAUTHENTICATED' });
    const wrongPerson = await loginAs(t, 'admin@firma-a.example');
    await t
      .http()
      .post('/api/v1/invitations/accept')
      .set('Cookie', wrongPerson)
      .send({ token })
      .expect(401);

    const agent = await loginAs(t, 'agent@firma-a.example');
    const accepted = await t
      .http()
      .post('/api/v1/invitations/accept')
      .set('Cookie', agent)
      .send({ token })
      .expect(200);
    expect(accepted.body).toMatchObject({ companyId: companyB });
    await loginAs(t, 'agent@firma-a.example', PASSWORD);
    const me = await t.http().get('/api/v1/auth/me').set('Cookie', agent).expect(200);
    expect((me.body as { user: { memberships: unknown[] } }).user.memberships).toHaveLength(2);
  });

  it('protokolliert Einladung und Annahme im Audit-Log der Firma', async () => {
    const admin = await loginAs(t, 'admin@firma-a.example');
    await invite(admin, companyA, { email: NEW_EMAIL, role: 'AGENT' }).expect(201);
    const token = t.mailer.tokenSentTo(NEW_EMAIL);
    await t
      .http()
      .post('/api/v1/invitations/accept')
      .send({ token, displayName: 'Lina', password: PASSWORD })
      .expect(201);
    const actions = await t.prisma.auditLog.findMany({
      where: { companyId: companyA },
      orderBy: { occurredAt: 'asc' },
      select: { action: true },
    });
    expect(actions.map((entry) => entry.action)).toEqual([
      'INVITATION_CREATED',
      'INVITATION_ACCEPTED',
    ]);
  });
});
