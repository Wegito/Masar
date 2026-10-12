import { RequestMethod, VERSION_NEUTRAL } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA, VERSION_METADATA } from '@nestjs/common/constants.js';
import { DiscoveryModule, DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { Public } from '../src/modules/auth/decorators.js';

interface Route {
  method: string;
  path: string;
  isPublic: boolean;
}

/** Bewusst öffentliche Routen. Eine neue öffentliche Route muss hier ergänzt werden. */
const EXPECTED_PUBLIC_ROUTES = [
  'GET /api/health/live',
  'GET /api/health/ready',
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/password-reset/confirm',
  'POST /api/v1/auth/password-reset/request',
  'POST /api/v1/invitations/accept',
];

function joinPath(...parts: string[]): string {
  return `/${parts
    .flatMap((part) => part.split('/'))
    .filter(Boolean)
    .join('/')}`;
}

/** Liest alle Routen aus den Metadaten der Controller, wie Nest sie registriert. */
function collectRoutes(app: NestExpressApplication): Route[] {
  const discovery = app.get(DiscoveryService);
  const scanner = app.get(MetadataScanner);
  const reflector = app.get(Reflector);
  const routes: Route[] = [];
  for (const wrapper of discovery.getControllers()) {
    const controller = wrapper.metatype as (new (...args: never[]) => object) | null;
    if (!controller) continue;
    const basePath = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
    const version: unknown = Reflect.getMetadata(VERSION_METADATA, controller);
    const versionSegment = version === VERSION_NEUTRAL ? '' : 'v1';
    const prototype = controller.prototype as Record<string, unknown>;
    for (const name of scanner.getAllMethodNames(prototype)) {
      const handler = prototype[name] as object;
      const method: unknown = Reflect.getMetadata(METHOD_METADATA, handler);
      if (method === undefined) continue;
      const path = String(Reflect.getMetadata(PATH_METADATA, handler) ?? '');
      const isPublic = reflector.getAllAndOverride(Public, [handler as never, controller]) === true;
      routes.push({
        method: RequestMethod[method as RequestMethod],
        path: joinPath('api', versionSegment, basePath, path),
        isPublic,
      });
    }
  }
  return routes.sort((a, b) => `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`));
}

describe('Routen und Anmeldepflicht', () => {
  let app: NestExpressApplication;
  let routes: Route[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, DiscoveryModule],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
    configureApp(app);
    await app.init();
    routes = collectRoutes(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('findet überhaupt Routen (sonst wäre der Test wertlos)', () => {
    expect(routes.length).toBeGreaterThan(EXPECTED_PUBLIC_ROUTES.length);
  });

  it('hat genau die bewusst öffentlichen Routen', () => {
    expect(
      routes.filter((route) => route.isPublic).map((route) => `${route.method} ${route.path}`),
    ).toEqual(EXPECTED_PUBLIC_ROUTES);
  });

  it('verlangt auf jeder anderen Route eine Anmeldung', async () => {
    const protectedRoutes = routes.filter((route) => !route.isPublic);
    for (const route of protectedRoutes) {
      const path = route.path.replace(/:[A-Za-z]+/g, '0199f7a4-5c2e-7d3a-9b1e-2f4c6a8d0e12');
      const res = await request(app.getHttpServer())
        [route.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete'](path)
        .send({});
      expect(`${route.method} ${route.path} -> ${res.status}`).toBe(
        `${route.method} ${route.path} -> 401`,
      );
    }
  });
});
