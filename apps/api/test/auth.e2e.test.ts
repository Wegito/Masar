import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  ANOTHER_PASSWORD,
  createStaff,
  createTestApp,
  loginAs,
  NEW_PASSWORD,
  PASSWORD,
  resetDatabase,
  sessionCookie,
  type TestApp,
} from './helpers/app.js';

const EMAIL = 'agent@firma.example';

describe('Anmeldung von Personal (Integration)', () => {
  let t: TestApp;

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
  });

  describe('Login', () => {
    it('meldet an, setzt ein sicheres Cookie und gibt keinen Passwort-Hash zurück', async () => {
      await createStaff(t.prisma, { email: EMAIL, password: PASSWORD });
      const res = await t
        .http()
        .post('/api/v1/auth/login')
        .send({ email: ' Agent@Firma.EXAMPLE ', password: PASSWORD })
        .expect(200);

      const raw = (res.headers['set-cookie'] as unknown as string[])[0] ?? '';
      expect(raw).toMatch(/^__Host-masar_session=[A-Za-z0-9_-]{43};/);
      expect(raw).toMatch(/; HttpOnly/);
      expect(raw).toMatch(/; Secure/);
      expect(raw).toMatch(/; SameSite=Lax/);
      expect(raw).toMatch(/; Path=\//);
      expect(raw).not.toMatch(/Domain=/i);
      expect(res.body).toMatchObject({ user: { email: EMAIL, memberships: [] } });
      expect(JSON.stringify(res.body)).not.toMatch(/argon2|passwordHash/);
    });

    it('antwortet bei falschem Passwort und unbekannter Adresse gleich', async () => {
      await createStaff(t.prisma, { email: EMAIL, password: PASSWORD });
      const wrong = await t
        .http()
        .post('/api/v1/auth/login')
        .send({ email: EMAIL, password: 'falsch-falsch-falsch' })
        .expect(401);
      const unknown = await t
        .http()
        .post('/api/v1/auth/login')
        .send({ email: 'niemand@firma.example', password: 'falsch-falsch-falsch' })
        .expect(401);
      const strip = (body: Record<string, unknown>) => ({ ...body, instance: undefined });
      expect(strip(wrong.body as Record<string, unknown>)).toEqual(
        strip(unknown.body as Record<string, unknown>),
      );
      expect(wrong.body).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    });

    it('verzögert nach fünf Fehlversuchen, sperrt dann auch das richtige Passwort und gibt danach frei', async () => {
      const { id } = await createStaff(t.prisma, { email: EMAIL, password: PASSWORD });
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        await t
          .http()
          .post('/api/v1/auth/login')
          .send({ email: EMAIL, password: 'falsch-falsch-falsch' })
          .expect(401);
      }
      const blocked = await t
        .http()
        .post('/api/v1/auth/login')
        .send({ email: EMAIL, password: PASSWORD })
        .expect(429);
      expect(blocked.body).toMatchObject({ code: 'LOGIN_THROTTLED' });
      expect(Number(blocked.headers['retry-after'])).toBe(60);

      t.clock.advance(61_000);
      await t
        .http()
        .post('/api/v1/auth/login')
        .send({ email: EMAIL, password: PASSWORD })
        .expect(200);
      const user = await t.prisma.user.findUniqueOrThrow({ where: { id } });
      expect(user.failedLogins).toBe(0);
      expect(user.lockedUntil).toBeNull();
    });

    it('lässt deaktivierte Konten nicht hinein und beendet ihre Sitzungen', async () => {
      const { id } = await createStaff(t.prisma, { email: EMAIL, password: PASSWORD });
      const cookie = await loginAs(t, EMAIL);
      await t.prisma.user.update({ where: { id }, data: { status: 'DISABLED' } });
      await t.http().get('/api/v1/auth/me').set('Cookie', cookie).expect(401);
      const res = await t
        .http()
        .post('/api/v1/auth/login')
        .send({ email: EMAIL, password: PASSWORD })
        .expect(401);
      expect(res.body).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    });
  });

  describe('Sitzungen', () => {
    it('erkennt die Sitzung per Cookie und per Bearer-Token', async () => {
      await createStaff(t.prisma, { email: EMAIL, password: PASSWORD });
      const cookie = await loginAs(t, EMAIL);
      await t.http().get('/api/v1/auth/me').set('Cookie', cookie).expect(200);
      const token = cookie.split('=')[1] ?? '';
      const res = await t
        .http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body).toMatchObject({ user: { email: EMAIL } });
    });

    it('verlangt ohne Sitzung eine Anmeldung', async () => {
      const res = await t.http().get('/api/v1/auth/me').expect(401);
      expect(res.body).toMatchObject({ code: 'UNAUTHENTICATED' });
      await t.http().get('/api/v1/auth/me').set('Authorization', 'Bearer erfunden').expect(401);
    });

    it('widerruft die Sitzung beim Abmelden', async () => {
      await createStaff(t.prisma, { email: EMAIL, password: PASSWORD });
      const cookie = await loginAs(t, EMAIL);
      await t.http().post('/api/v1/auth/logout').set('Cookie', cookie).expect(204);
      await t.http().get('/api/v1/auth/me').set('Cookie', cookie).expect(401);
    });

    it('beendet Sitzungen nach 12 Stunden ohne Aktivität', async () => {
      await createStaff(t.prisma, { email: EMAIL, password: PASSWORD });
      const cookie = await loginAs(t, EMAIL);
      t.clock.advance(11 * 3_600_000);
      await t.http().get('/api/v1/auth/me').set('Cookie', cookie).expect(200);
      t.clock.advance(12 * 3_600_000 + 60_000);
      await t.http().get('/api/v1/auth/me').set('Cookie', cookie).expect(401);
    });
  });

  describe('CSRF-Schutz', () => {
    it('lehnt zustandsändernde Anfragen von fremden Origins ab', async () => {
      await createStaff(t.prisma, { email: EMAIL, password: PASSWORD });
      const res = await t
        .http()
        .post('/api/v1/auth/login')
        .set('Origin', 'https://boese.example')
        .send({ email: EMAIL, password: PASSWORD })
        .expect(403);
      expect(res.body).toMatchObject({ code: 'FORBIDDEN' });
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('nimmt Anfragen von erlaubten Origins an', async () => {
      await createStaff(t.prisma, { email: EMAIL, password: PASSWORD });
      await t
        .http()
        .post('/api/v1/auth/login')
        .set('Origin', 'http://localhost:3002')
        .send({ email: EMAIL, password: PASSWORD })
        .expect(200);
    });

    it.each([
      ['Formular', 'application/x-www-form-urlencoded', `email=${EMAIL}&password=${PASSWORD}`],
      ['Klartext', 'text/plain', JSON.stringify({ email: EMAIL, password: PASSWORD })],
    ])(
      'lehnt %s-Bodies ab (415), die Browser ohne Vorabprüfung senden dürfen',
      async (_label, type, body) => {
        await createStaff(t.prisma, { email: EMAIL, password: PASSWORD });
        const res = await t
          .http()
          .post('/api/v1/auth/login')
          .set('Content-Type', type)
          .send(body)
          .expect(415);
        expect(res.body).toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE' });
      },
    );

    it('lehnt als cross-site markierte Anfragen ohne Origin ab', async () => {
      await createStaff(t.prisma, { email: EMAIL, password: PASSWORD });
      await t
        .http()
        .post('/api/v1/auth/login')
        .set('Sec-Fetch-Site', 'cross-site')
        .send({ email: EMAIL, password: PASSWORD })
        .expect(403);
    });
  });

  describe('Passwort-Reset', () => {
    it('antwortet für bekannte und unbekannte Adressen gleich, sendet aber nur an bekannte', async () => {
      await createStaff(t.prisma, { email: EMAIL, password: PASSWORD });
      const known = await t
        .http()
        .post('/api/v1/auth/password-reset/request')
        .send({ email: EMAIL })
        .expect(202);
      const unknown = await t
        .http()
        .post('/api/v1/auth/password-reset/request')
        .send({ email: 'niemand@firma.example' })
        .expect(202);
      expect(known.body).toEqual(unknown.body);
      expect(t.mailer.sent.map((mail) => mail.to)).toEqual([EMAIL]);
      expect(t.mailer.sent[0]?.text).toMatch(/\/auth\/reset-password#token=/);
      expect(t.mailer.sent[0]?.text).not.toMatch(/\?token=/);
    });

    it('setzt das Passwort, meldet alle Sitzungen ab und gilt nur einmal', async () => {
      await createStaff(t.prisma, { email: EMAIL, password: PASSWORD });
      const oldSession = await loginAs(t, EMAIL);
      await t.http().post('/api/v1/auth/password-reset/request').send({ email: EMAIL }).expect(202);
      const token = t.mailer.tokenSentTo(EMAIL);
      const newPassword = NEW_PASSWORD;

      await t
        .http()
        .post('/api/v1/auth/password-reset/confirm')
        .send({ token, password: newPassword })
        .expect(204);
      await t.http().get('/api/v1/auth/me').set('Cookie', oldSession).expect(401);
      await loginAs(t, EMAIL, newPassword);
      await t
        .http()
        .post('/api/v1/auth/login')
        .send({ email: EMAIL, password: PASSWORD })
        .expect(401);

      const reused = await t
        .http()
        .post('/api/v1/auth/password-reset/confirm')
        .send({ token, password: ANOTHER_PASSWORD })
        .expect(400);
      expect(reused.body).toMatchObject({ code: 'PASSWORD_RESET_INVALID' });
    });

    it('lehnt abgelaufene Links ab', async () => {
      await createStaff(t.prisma, { email: EMAIL, password: PASSWORD });
      await t.http().post('/api/v1/auth/password-reset/request').send({ email: EMAIL }).expect(202);
      const token = t.mailer.tokenSentTo(EMAIL);
      t.clock.advance(31 * 60_000);
      const res = await t
        .http()
        .post('/api/v1/auth/password-reset/confirm')
        .send({ token, password: NEW_PASSWORD })
        .expect(400);
      expect(res.body).toMatchObject({ code: 'PASSWORD_RESET_INVALID' });
    });

    it('verlangt mindestens 12 Zeichen', async () => {
      const res = await t
        .http()
        .post('/api/v1/auth/password-reset/confirm')
        .send({ token: 'x'.repeat(43), password: 'kurz' })
        .expect(400);
      expect(res.body).toMatchObject({
        code: 'VALIDATION_FAILED',
        errors: [{ path: 'password', rule: 'too_small' }],
      });
    });
  });

  describe('Audit-Log', () => {
    it('protokolliert Anmeldungen mit Request-ID, aber ohne Personendaten', async () => {
      const { id } = await createStaff(t.prisma, { email: EMAIL, password: PASSWORD });
      const res = await t
        .http()
        .post('/api/v1/auth/login')
        .send({ email: EMAIL, password: PASSWORD })
        .expect(200);
      const entries = await t.prisma.auditLog.findMany({ where: { action: 'LOGIN_SUCCEEDED' } });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ actorId: id, requestId: res.headers['x-request-id'] });
      expect(JSON.stringify(entries)).not.toContain(EMAIL);
      expect(sessionCookie(res)).not.toBe('');
    });

    it('ist für die Anwendungsrolle unveränderlich (nur anhängen)', async () => {
      const { id } = await createStaff(t.prisma, { email: EMAIL, password: PASSWORD });
      await loginAs(t, EMAIL);
      await expect(
        t.prisma.auditLog.updateMany({ where: { actorId: id }, data: { action: 'GEFÄLSCHT' } }),
      ).rejects.toThrow(/permission denied/i);
      await expect(t.prisma.auditLog.deleteMany({ where: { actorId: id } })).rejects.toThrow(
        /permission denied/i,
      );
    });
  });
});
