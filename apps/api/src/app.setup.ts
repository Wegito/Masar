import { VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import type { Env } from './config/env.js';

const DOCS_PATH = 'api/docs';

/** Strenge Header für JSON-Antworten: nichts darf geladen oder eingebettet werden. */
const apiHelmet = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
  },
});
/** Die API-Dokumentation (nur außerhalb der Produktion) braucht eigene Skripte und Styles. */
const docsHelmet = helmet();

/**
 * Gemeinsame Einrichtung für Server und Tests, damit Tests dieselbe Konfiguration prüfen,
 * die in Produktion läuft.
 */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  app.useLogger(app.get(Logger));
  app.set('trust proxy', config.get('TRUST_PROXY', { infer: true }));
  app.use((req: Request, res: Response, next: NextFunction) =>
    req.path.startsWith(`/${DOCS_PATH}`) ? docsHelmet(req, res, next) : apiHelmet(req, res, next),
  );
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableShutdownHooks();

  if (config.get('NODE_ENV', { infer: true }) !== 'production') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Masar API').setVersion('1').build(),
    );
    SwaggerModule.setup(DOCS_PATH, app, document);
  }
}
