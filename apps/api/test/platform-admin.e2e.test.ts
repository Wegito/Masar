import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { grantPlatformAdmin } from '../src/scripts/platform-admin.js';
import { createTestApp, loginAs, resetDatabase, type TestApp } from './helpers/app.js';

describe('Einstieg: erste Plattform-Admin-Person (Integration)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.app.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    t.resetRateLimits();
  });

  it('legt das Konto an; über den Link wird das Passwort gesetzt, danach gelingt die Anmeldung', async () => {
    const { setupLink } = await grantPlatformAdmin(t.prisma, {
      email: 'Betrieb@Masar.example',
      displayName: 'Betrieb',
      locale: 'ar',
      portalUrl: 'http://localhost:3002',
      now: t.clock.now(),
    });
    expect(setupLink).toMatch(
      /^http:\/\/localhost:3002\/ar\/auth\/reset-password#token=[A-Za-z0-9_-]{43}$/,
    );
    const token = setupLink.split('#token=')[1] ?? '';

    await t
      .http()
      .post('/api/v1/auth/password-reset/confirm')
      .send({ token, password: 'start-passwort-betrieb-26' })
      .expect(204);
    const cookie = await loginAs(t, 'betrieb@masar.example', 'start-passwort-betrieb-26');
    const me = await t.http().get('/api/v1/auth/me').set('Cookie', cookie).expect(200);
    expect(me.body).toMatchObject({
      user: { isPlatformAdmin: true, email: 'betrieb@masar.example' },
    });
    const audit = await t.prisma.auditLog.findFirst({
      where: { action: 'PLATFORM_ADMIN_GRANTED' },
    });
    expect(audit).toMatchObject({ actorType: 'SYSTEM' });
  });

  it('macht ein bestehendes Konto zur Plattform-Admin-Person, ohne dessen Passwort zu ändern', async () => {
    await grantPlatformAdmin(t.prisma, {
      email: 'person@masar.example',
      displayName: 'P',
      locale: 'en',
      portalUrl: 'http://x.example',
      now: t.clock.now(),
    });
    const again = await grantPlatformAdmin(t.prisma, {
      email: 'person@masar.example',
      displayName: 'P',
      locale: 'en',
      portalUrl: 'http://x.example',
      now: t.clock.now(),
    });
    const user = await t.prisma.user.findUniqueOrThrow({
      where: { email: 'person@masar.example' },
    });
    expect(user.id).toBe(again.userId);
    expect(user.passwordHash).toBeNull();
    expect(await t.prisma.user.count()).toBe(1);
  });
});
