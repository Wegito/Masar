import type { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import type { Env } from '../src/config/env.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

async function createApp(prisma?: PrismaService): Promise<NestExpressApplication> {
  const builder = Test.createTestingModule({ imports: [AppModule] });
  if (prisma) {
    builder.overrideProvider(PrismaService).useValue(prisma);
  }
  const app = (await builder.compile()).createNestApplication<NestExpressApplication>({
    bufferLogs: true,
  });
  configureApp(app);
  await app.init();
  return app;
}

describe('Datenbank (Integration gegen PostgreSQL)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('meldet ready, wenn die Datenbank erreichbar ist, ohne Details preiszugeben', async () => {
    const res = await request(app.getHttpServer()).get('/api/health/ready').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('hat die handgeschriebene Migration angewendet: btree_gist existiert (ADR 0004)', async () => {
    const rows = await prisma.$queryRaw<{ extname: string }[]>`
      SELECT extname FROM pg_extension WHERE extname = 'btree_gist'`;
    expect(rows).toEqual([{ extname: 'btree_gist' }]);
  });

  it('verbindet sich mit der Anwendungsrolle, die kein DDL darf', async () => {
    const [who] = await prisma.$queryRaw<{ current_user: string }[]>`SELECT current_user`;
    expect(who?.current_user).toBe('masar_app');
    await expect(prisma.$executeRawUnsafe('CREATE TABLE verboten (id int)')).rejects.toThrow(
      /permission denied/i,
    );
  });

  it('setzt die Timeouts aus dem Sperrkonzept für jede Verbindung', async () => {
    const [settings] = await prisma.$queryRaw<
      { lock: string; statement: string; idle: string; app: string }[]
    >`SELECT current_setting('lock_timeout') AS lock,
             current_setting('statement_timeout') AS statement,
             current_setting('idle_in_transaction_session_timeout') AS idle,
             current_setting('application_name') AS app`;
    expect(settings).toEqual({ lock: '5s', statement: '10s', idle: '10s', app: 'masar-api' });
  });
});

describe('Readiness ohne erreichbare Datenbank', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const unreachable = {
      get: () => 'postgresql://masar_app:x@127.0.0.1:1/nicht_da',
    } as unknown as ConfigService<Env, true>;
    app = await createApp(new PrismaService(unreachable));
  });

  afterAll(async () => {
    await app.close();
  });

  it('antwortet schnell mit 503 SERVICE_UNAVAILABLE statt zu hängen', async () => {
    const started = Date.now();
    const res = await request(app.getHttpServer()).get('/api/health/ready').expect(503);
    expect(Date.now() - started).toBeLessThan(6_000);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(res.body).toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
    expect(JSON.stringify(res.body)).not.toContain('database');
  });

  it('bleibt live, weil der Prozess selbst gesund ist', async () => {
    await request(app.getHttpServer()).get('/api/health/live').expect(200);
  });
});
