import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AppError } from '../../common/app-error.js';
import type { AuthedRequest } from './auth.types.js';
import { PlatformAdminOnly } from './decorators.js';

/**
 * Lässt Routen mit `@PlatformAdminOnly()` nur für Plattform-Admins durch (`user.is_platform_admin`,
 * aus der geprüften Sitzung). Firmen-Admins ergeben `FORBIDDEN`, auch für die eigene Firma: Den
 * Lizenzstand pflegt nur die Plattform (ADR 0029).
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride(PlatformAdminOnly, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required !== true) {
      return true;
    }
    const auth = context.switchToHttp().getRequest<AuthedRequest>().auth;
    if (!auth) {
      throw new AppError('UNAUTHENTICATED');
    }
    if (!auth.isPlatformAdmin) {
      throw new AppError('FORBIDDEN');
    }
    return true;
  }
}
