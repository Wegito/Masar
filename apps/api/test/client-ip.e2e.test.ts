import { randomUUID } from 'node:crypto';

import { forwardedClientIp } from '@masar/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Welche IP sieht die API als Client (`req.ip`), je nach `TRUST_PROXY` (ADR 0033)? Gemessen an der
 * IP, die der Login in die Sitzung schreibt (`requestContext`, dieselbe Quelle wie Audit-Log und
 * Ratenbegrenzung). Dazu die Grenze der Code-Suche je Client (H2): Wer einen fremden Code
 * durchprobiert, sperrt sich selbst, nicht den Fahrgast.
 *
 * `TRUST_PROXY` wird beim Laden des AppModule geprüft. Jeder Block lädt deshalb die Module frisch
 * mit seinem Wert (`vi.resetModules`).
 */

const PASSENGER_IP = '203.0.113.7';
const ATTACKER_IP = '198.51.100.9';
const FORGED_IP = '6.6.6.6';
const PHONE = '+963933778001';

async function load(trustProxy: '0' | '1') {
  vi.resetModules();
  vi.stubEnv('TRUST_PROXY', trustProxy);
  const helpers = await import('./helpers/app.js');
  const bookingHelpers = await import('./helpers/bookings.js');
  const { LookupLimiter, LOOKUP_ATTEMPTS_PER_CODE_AND_CLIENT } =
    await import('../src/modules/bookings/lookup-limiter.js');
  await helpers.resetDatabase();
  const t = await helpers.createTestApp();
  return {
    helpers,
    bookingHelpers,
    t,
    resetLimits: () => {
      t.resetRateLimits();
      t.app.get(LookupLimiter).reset();
    },
    perClient: LOOKUP_ATTEMPTS_PER_CODE_AND_CLIENT,
  };
}

type Loaded = Awaited<ReturnType<typeof load>>;

/** Meldet sich mit dem gegebenen `X-Forwarded-For` an und liefert die IP der neuen Sitzung. */
async function sessionIp(env: Loaded, forwardedFor: string | null): Promise<string | null> {
  const email = `ip-${randomUUID()}@firma.example`;
  const user = await env.helpers.createStaff(env.t.prisma, {
    email,
    password: env.helpers.PASSWORD,
  });
  let req = env.t.http().post('/api/v1/auth/login');
  if (forwardedFor !== null) {
    req = req.set('X-Forwarded-For', forwardedFor);
  }
  await req.send({ email, password: env.helpers.PASSWORD }).expect(200);
  const session = await env.t.prisma.session.findFirstOrThrow({
    where: { userId: user.id },
    select: { ip: true },
  });
  return session.ip;
}

afterAll(() => {
  vi.unstubAllEnvs();
});

describe('TRUST_PROXY=0 (Entwicklung, API ohne Proxy davor)', () => {
  let env: Loaded;

  beforeAll(async () => {
    env = await load('0');
  });

  afterAll(async () => {
    await env.t.app.close();
  });

  beforeEach(() => {
    env.resetLimits();
  });

  it('ignoriert X-Forwarded-For: req.ip ist der direkte Gegenüber', async () => {
    const forged = await sessionIp(env, `${FORGED_IP}, ${PASSENGER_IP}`);
    const plain = await sessionIp(env, null);
    expect(forged).not.toBe(FORGED_IP);
    expect(forged).not.toBe(PASSENGER_IP);
    expect(forged).toBe(plain);
    expect(plain).toMatch(/127\.0\.0\.1$|^::1$/);
  });
});

describe('TRUST_PROXY=1 (Produktion: Caddy oder Web/Portal direkt vor der API)', () => {
  let env: Loaded;

  beforeAll(async () => {
    env = await load('1');
  });

  afterAll(async () => {
    await env.t.app.close();
  });

  beforeEach(() => {
    env.resetLimits();
  });

  afterEach(() => {
    env.resetLimits();
  });

  it('nimmt den letzten Eintrag der Kette, gefälschte Einträge davor zählen nicht', async () => {
    expect(await sessionIp(env, PASSENGER_IP)).toBe(PASSENGER_IP);
    expect(await sessionIp(env, `${FORGED_IP}, ${PASSENGER_IP}`)).toBe(PASSENGER_IP);
    expect(await sessionIp(env, `${FORGED_IP},10.0.0.1, ${PASSENGER_IP}`)).toBe(PASSENGER_IP);
    expect(await sessionIp(env, 'fe80::1, 2001:db8::7')).toBe('2001:db8::7');
    // Ohne Header bleibt es der direkte Gegenüber.
    expect(await sessionIp(env, null)).toMatch(/127\.0\.0\.1$|^::1$/);
  });

  it('Kette Caddy → Web → API: die API sieht genau die IP, die Caddy gesetzt hat', async () => {
    // Der Client schickt selbst X-Forwarded-For. Caddy ersetzt ihn durch die echte IP; selbst ein
    // falsch eingerichteter, anhängender Proxy ließe die echte IP am Ende stehen.
    for (const fromCaddy of [PASSENGER_IP, `${FORGED_IP}, ${PASSENGER_IP}`]) {
      // So reicht Web oder Portal weiter (src/lib/api.ts, src/lib/session.ts).
      const forwarded = forwardedClientIp(fromCaddy);
      expect(forwarded).toBe(PASSENGER_IP);
      expect(await sessionIp(env, forwarded)).toBe(PASSENGER_IP);
    }
    // Müll im Header: Web lässt ihn weg, die API sieht den Web-Server statt einer erfundenen IP.
    expect(forwardedClientIp(`${PASSENGER_IP}, <script>`)).toBeNull();
  });

  it('Code-Suche: ein fremder Client sperrt sich selbst, der Fahrgast findet seine Buchung', async () => {
    const bookable = await env.bookingHelpers.createBookableTrip(env.t.prisma);
    const booking = await env.bookingHelpers.hold(env.t, bookable, {
      passengers: [{ label: '1A', gender: 'FEMALE', fullName: 'Lina Haddad' }],
      from: 1,
      to: 3,
      phone: PHONE,
    });
    const lookup = (ip: string, phone: string) =>
      env.t
        .http()
        .post('/api/v1/bookings/lookup')
        .set('X-Forwarded-For', ip)
        .send({ bookingCode: booking.bookingCode, phone });

    // Der Angreifer kennt den Code (Foto des Tickets) und probiert Telefonnummern.
    for (let i = 0; i < env.perClient; i++) {
      // Die Grenze je IP und Minute (5) setzt der Test zurück, damit die Grenze je Code greift.
      env.t.resetRateLimits();
      const res = await lookup(ATTACKER_IP, `+9639337781${String(i).padStart(2, '0')}`);
      expect(res.status).toBe(404);
    }
    env.t.resetRateLimits();

    // Zwei Clients gleichzeitig über eigene Verbindungen: Angreifer gesperrt, auch mit dem
    // richtigen Telefon; der Fahrgast von seiner IP nicht.
    const [attacker, passenger] = await Promise.all([
      lookup(ATTACKER_IP, PHONE),
      lookup(PASSENGER_IP, PHONE),
    ]);
    expect(attacker.status).toBe(429);
    expect((attacker.body as { code: string }).code).toBe('RATE_LIMITED');
    expect(Number(attacker.headers['retry-after'])).toBeGreaterThan(0);
    expect(passenger.status).toBe(200);
    expect((passenger.body as { booking: { id: string } }).booking.id).toBe(booking.id);
  });
});
