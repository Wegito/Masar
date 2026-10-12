import { Body, Controller, Get, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Throttle } from '@nestjs/throttler';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { AppError } from '../src/common/app-error.js';
import { Public } from '../src/modules/auth/decorators.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const echoSchema = z.object({
  phone: z.string().min(5),
  seats: z.array(z.string()).min(1),
});

/** Nur für diesen Test: Endpunkte, die die Querschnittsfunktionen auslösen. */
@Controller('__test')
@Public()
class TestController {
  @Post('echo')
  echo(@Body({ schema: echoSchema }) body: z.infer<typeof echoSchema>) {
    return body;
  }

  @Get('seat-taken')
  seatTaken(): never {
    throw new AppError('SEAT_TAKEN', { params: { seats: ['12'] } });
  }

  @Get('boom')
  boom(): never {
    throw new Error('interne Nachricht mit +963933123456');
  }

  @Get('limited')
  @Throttle({ default: { limit: 2, ttl: 60_000 } })
  limited() {
    return { ok: true };
  }
}

describe('API-Grundgerüst (Ende zu Ende)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [TestController],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  describe('Health', () => {
    it('meldet live ohne Versionspräfix', async () => {
      const res = await http().get('/api/health/live').expect(200);
      expect(res.body).toEqual({ status: 'ok' });
    });

    it('meldet ready', async () => {
      await http().get('/api/health/ready').expect(200);
    });
  });

  describe('Request-ID', () => {
    it('erzeugt eine ID und gibt sie zurück', async () => {
      const res = await http().get('/api/health/live');
      expect(res.headers['x-request-id']).toMatch(UUID);
    });

    it('übernimmt eine gültige UUID des Aufrufers', async () => {
      const id = '0199f7a4-5c2e-7d3a-9b1e-2f4c6a8d0e12';
      const res = await http().get('/api/health/live').set('X-Request-Id', id);
      expect(res.headers['x-request-id']).toBe(id);
    });

    it('ersetzt eine ungültige ID statt sie zu übernehmen', async () => {
      const res = await http().get('/api/health/live').set('X-Request-Id', 'abc');
      expect(res.headers['x-request-id']).not.toBe('abc');
      expect(res.headers['x-request-id']).toMatch(UUID);
    });
  });

  describe('Fehlerformat (RFC 9457)', () => {
    it('beantwortet unbekannte Routen mit NOT_FOUND und verknüpft die Request-ID', async () => {
      const res = await http().get('/api/v1/gibt-es-nicht').expect(404);
      expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
      expect(res.body).toEqual({
        type: 'about:blank',
        title: 'Not Found',
        status: 404,
        code: 'NOT_FOUND',
        instance: `urn:uuid:${res.headers['x-request-id']}`,
      });
    });

    it('liefert fachliche Fehler mit Code und Parametern', async () => {
      const res = await http().get('/api/v1/__test/seat-taken').expect(409);
      expect(res.body).toMatchObject({ code: 'SEAT_TAKEN', params: { seats: ['12'] } });
    });

    it('verrät bei unerwarteten Fehlern keine internen Details', async () => {
      const res = await http().get('/api/v1/__test/boom').expect(500);
      expect(res.body).toMatchObject({ code: 'INTERNAL_ERROR', status: 500 });
      expect(JSON.stringify(res.body)).not.toContain('interne Nachricht');
      expect(JSON.stringify(res.body)).not.toContain('963933123456');
      expect(res.body).not.toHaveProperty('detail');
    });
  });

  describe('Validierung', () => {
    it('lehnt ungültige Eingaben mit VALIDATION_FAILED und Feldliste ab', async () => {
      const res = await http().post('/api/v1/__test/echo').send({ seats: [] }).expect(400);
      expect(res.body).toMatchObject({
        code: 'VALIDATION_FAILED',
        errors: expect.arrayContaining([
          { path: 'phone', rule: 'invalid_type' },
          { path: 'seats', rule: 'too_small' },
        ]) as unknown,
      });
    });

    it('nimmt gültige Eingaben an und entfernt unbekannte Felder', async () => {
      const res = await http()
        .post('/api/v1/__test/echo')
        .send({ phone: '0933123456', seats: ['12'], extra: 'weg' })
        .expect(201);
      expect(res.body).toEqual({ phone: '0933123456', seats: ['12'] });
    });

    it('beantwortet kaputtes JSON im selben Format statt mit einer HTML-Seite', async () => {
      const res = await http()
        .post('/api/v1/__test/echo')
        .set('Content-Type', 'application/json')
        .send('{"phone": ')
        .expect(400);
      expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
      expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    });
  });

  describe('Ratenbegrenzung', () => {
    it('antwortet nach dem Limit mit RATE_LIMITED und Retry-After', async () => {
      await http().get('/api/v1/__test/limited').expect(200);
      await http().get('/api/v1/__test/limited').expect(200);
      const res = await http().get('/api/v1/__test/limited').expect(429);
      expect(res.body).toMatchObject({ code: 'RATE_LIMITED', status: 429 });
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    });
  });

  describe('Sicherheitsheader', () => {
    it('setzt strenge Header und verrät das Framework nicht', async () => {
      const res = await http().get('/api/health/live');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toBe(
        "default-src 'none';frame-ancestors 'none'",
      );
      expect(res.headers).not.toHaveProperty('x-powered-by');
    });
  });

  describe('API-Dokumentation', () => {
    it('ist außerhalb der Produktion erreichbar', async () => {
      await http().get('/api/docs-json').expect(200);
    });
  });
});
