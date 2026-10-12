import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

import type { Env } from '../config/env.js';
import { AppError } from './app-error.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Schutz vor Cross-Site-Request-Forgery für zustandsändernde Anfragen (ADR 0009), zusätzlich zu
 * SameSite=Lax am Cookie:
 * - Ein Body muss JSON sein. Formulare und text/plain, die ein Browser ohne Vorabprüfung von
 *   fremden Seiten senden darf, werden abgelehnt.
 * - Schickt der Browser einen Origin, muss er auf der Liste stehen. Ohne Origin (z. B. native App
 *   mit Bearer-Token oder curl) wird eine als cross-site markierte Anfrage abgelehnt.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly allowedOrigins: ReadonlySet<string>;

  constructor(config: ConfigService<Env, true>) {
    this.allowedOrigins = new Set(config.get('APP_ORIGINS', { infer: true }));
  }

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') {
      return true;
    }
    const req = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method)) {
      return true;
    }
    const hasBody =
      Number(req.headers['content-length'] ?? '0') > 0 ||
      req.headers['transfer-encoding'] !== undefined;
    if (hasBody && req.is('application/json') === false) {
      throw new AppError('UNSUPPORTED_MEDIA_TYPE', { detail: 'Request bodies must be JSON.' });
    }
    const origin = req.headers.origin;
    if (origin !== undefined && !this.allowedOrigins.has(origin)) {
      throw new AppError('FORBIDDEN', { detail: 'Origin not allowed.' });
    }
    if (origin === undefined && req.headers['sec-fetch-site'] === 'cross-site') {
      throw new AppError('FORBIDDEN', { detail: 'Cross-site request.' });
    }
    return true;
  }
}
