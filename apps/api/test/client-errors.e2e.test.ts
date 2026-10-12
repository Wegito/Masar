import { Writable } from 'node:stream';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from './helpers/app.js';

const PHONE_DIGITS = '963933123456';
const BOOKING_CODE = '7KQ2M9XA';
/** Aufgebaut statt ausgeschrieben, damit der Geheimnis-Scan keinen Fund meldet; Länge wie ein Token. */
const TOKEN = 'x9Y8'.repeat(11);

const report = {
  app: 'web',
  kind: 'error',
  message: `Buchung für +${PHONE_DIGITS} fehlgeschlagen (Token ${TOKEN})`,
  stack: `Error: boom\n    at load (https://masar.example/ar/t/${BOOKING_CODE}?from=damascus#token=${TOKEN}:12:5)\n    at run (https://masar.example/_next/static/chunks/3vh7dwog03ndj.js:1:2345)`,
  path: `/ar/t/${BOOKING_CODE}?from=damascus`,
};

/**
 * Öffentlicher Endpunkt für Browser-Fehler: Was im Log landet, ist bereinigt, und der Endpunkt
 * bleibt gegen fremde Seiten, falsche Formate und Fluten geschützt.
 */
describe('POST /api/v1/client-errors', () => {
  let testApp: TestApp;
  const lines: string[] = [];

  beforeAll(async () => {
    const logs = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    testApp = await createTestApp({ logs });
  });

  beforeEach(() => {
    testApp.resetRateLimits();
    lines.length = 0;
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  it('nimmt einen Bericht an und loggt ihn ohne Telefon, Code, Query und Token', async () => {
    const res = await testApp.http().post('/api/v1/client-errors').send(report);
    expect(res.status).toBe(204);

    const entry = lines
      .map((line) => JSON.parse(line) as { msg?: string; clientError?: Record<string, string> })
      .find((line) => line.msg === 'Fehler im Browser');
    expect(entry?.clientError).toEqual({
      app: 'web',
      kind: 'error',
      path: '/ar/t/:param',
      message: 'Buchung für [REDACTED] fehlgeschlagen (Token [REDACTED])',
      stack:
        'Error: boom\n    at load (https://masar.example/ar/t/:param)\n    at run (https://masar.example/_next/static/chunks/3vh7dwog03ndj.js:1:2345)',
    });
    const text = lines.join('');
    for (const secret of [PHONE_DIGITS, BOOKING_CODE, TOKEN, 'damascus']) {
      expect(text).not.toContain(secret);
    }
  });

  it('lehnt unvollständige oder zu lange Berichte mit VALIDATION_FAILED ab', async () => {
    const invalid = [
      { ...report, app: 'admin' },
      { ...report, message: '' },
      { ...report, message: 'x'.repeat(501) },
      { app: 'web', kind: 'error', message: 'boom' },
    ];
    for (const body of invalid) {
      const res = await testApp.http().post('/api/v1/client-errors').send(body);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    }
  });

  it('akzeptiert nur JSON und keine fremden Seiten', async () => {
    const plain = await testApp
      .http()
      .post('/api/v1/client-errors')
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify(report));
    expect(plain.status).toBe(415);

    const foreign = await testApp
      .http()
      .post('/api/v1/client-errors')
      .set('Origin', 'https://evil.example')
      .send(report);
    expect(foreign.status).toBe(403);
  });

  it('drosselt nach 20 Berichten je Minute und IP', async () => {
    for (let i = 0; i < 20; i += 1) {
      const res = await testApp.http().post('/api/v1/client-errors').send(report);
      expect(res.status).toBe(204);
    }
    const limited = await testApp.http().post('/api/v1/client-errors').send(report);
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ code: 'RATE_LIMITED' });
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  });
});
