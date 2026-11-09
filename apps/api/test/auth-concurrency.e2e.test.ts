import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { lockDurationMs } from '../src/modules/auth/domain/lockout.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import {
  createStaff,
  createTestApp,
  PASSWORD,
  resetDatabase,
  type TestApp,
} from './helpers/app.js';
import { waitUntilApiBlocked } from './helpers/bookings.js';
import { connectRaw } from './helpers/inventory.js';

/**
 * Nebenläufigkeit der Wartezeit nach Fehlversuchen mit echten Datenbankverbindungen (AGENTS.md,
 * kritische Pfade: Auth).
 *
 * Muster wie im Buchungskern: Eine eigene Verbindung (`holder`) sperrt die Kontozeile. Die
 * parallelen Logins laufen über eigene Pool-Verbindungen und warten auf diese Sperre; `observer`
 * sieht in `pg_stat_activity`, dass alle warten. Erst dann gibt `holder` frei. So treffen die
 * Fehlversuche wirklich gleichzeitig aufeinander.
 */

const EMAIL = 'agent@firma.example';
const WRONG = 'falsch-falsch-falsch';
/** Unter dem Limit der Login-Route (10 Anfragen je Minute und IP). */
const PARALLEL_ATTEMPTS = 9;

describe('Wartezeit nach Fehlversuchen unter Nebenläufigkeit', () => {
  let t: TestApp;
  let holder: pg.Client;
  let observer: pg.Client;

  beforeAll(async () => {
    t = await createTestApp();
    holder = await connectRaw();
    observer = await connectRaw();
  });

  afterAll(async () => {
    await holder.end();
    await observer.end();
    await t.app.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    t.resetRateLimits();
    vi.restoreAllMocks();
  });

  it('parallele Fehlversuche bekommen höchstens fünf echte Prüfungen, danach scheitert auch das richtige Passwort', async () => {
    const { id } = await createStaff(t.prisma, { email: EMAIL, password: PASSWORD });
    const verify = vi.spyOn(t.app.get(PasswordService), 'verify');
    const now = t.clock.now();

    await holder.query('BEGIN');
    let responses: { status: number; body: unknown }[];
    try {
      await holder.query('SELECT id FROM "user" WHERE id = $1 FOR UPDATE', [id]);
      const pending = Array.from({ length: PARALLEL_ATTEMPTS }, () =>
        Promise.resolve(
          t.http().post('/api/v1/auth/login').send({ email: EMAIL, password: WRONG }),
        ),
      );
      await waitUntilApiBlocked(observer, PARALLEL_ATTEMPTS);
      await holder.query('COMMIT');
      responses = await Promise.all(pending);
    } catch (error) {
      await holder.query('ROLLBACK').catch(() => undefined);
      throw error;
    }

    for (const res of responses) {
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    }
    // Ab dem fünften Fehlversuch gilt die Wartezeit; alle weiteren prüfen nur gegen den Dummy-Hash.
    expect(verify).toHaveBeenCalledTimes(5);

    const user = await t.prisma.user.findUniqueOrThrow({ where: { id } });
    // Versuche während der Wartezeit zählen nicht, und die Wartezeit passt zum Zähler.
    expect(user.failedLogins).toBe(5);
    expect(user.lockedUntil?.getTime()).toBe(now.getTime() + lockDurationMs(5));
    const failures = await t.prisma.auditLog.count({
      where: { action: 'LOGIN_FAILED', entityId: id },
    });
    expect(failures).toBe(5);

    await t
      .http()
      .post('/api/v1/auth/login')
      .send({ email: EMAIL, password: PASSWORD })
      .expect(401);
    expect(verify).toHaveBeenCalledTimes(5);
  });
});
