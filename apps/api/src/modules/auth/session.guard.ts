import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AppError } from '../../common/app-error.js';
import type { AuthedRequest } from './auth.types.js';
import { Public } from './decorators.js';
import { SessionService } from './session.service.js';

/**
 * Globaler Guard: Jede Route verlangt eine gültige Sitzung, außer sie ist mit @Public markiert.
 * Auf öffentlichen Routen wird eine vorhandene Sitzung trotzdem erkannt (z. B. Einladung annehmen
 * als bereits angemeldete Person).
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') {
      return true;
    }
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const isPublic =
      this.reflector.getAllAndOverride(Public, [context.getHandler(), context.getClass()]) === true;
    const token = this.sessions.tokenFrom(req);
    const auth = token === undefined ? null : await this.sessions.resolve(token);
    if (auth) {
      req.auth = auth;
    }
    if (!isPublic && !auth) {
      throw new AppError('UNAUTHENTICATED');
    }
    return true;
  }
}
