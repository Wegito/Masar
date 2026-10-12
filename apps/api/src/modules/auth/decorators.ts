import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { CompanyRole } from '@masar/shared';

import { AppError } from '../../common/app-error.js';
import type { AuthContext, AuthedRequest } from './auth.types.js';

/**
 * Route ohne Anmeldung. Alles andere verlangt eine Sitzung (sicher als Standard); ein Test hält
 * die Liste öffentlicher Routen fest.
 */
export const Public = Reflector.createDecorator<undefined, true>({ transform: () => true });

export interface CompanyRoleRequirement {
  roles: readonly CompanyRole[];
  /** Plattform-Admins dürfen ohne Mitgliedschaft (z. B. ersten Firmen-Admin einladen). */
  allowPlatformAdmin?: boolean;
}

/** Verlangt eine aktive Mitgliedschaft mit einer der Rollen in der Firma aus `:companyId`. */
export const CompanyRoles = Reflector.createDecorator<CompanyRoleRequirement>();

/** Die geprüfte Identität; wirft UNAUTHENTICATED, falls keine vorhanden ist. */
export const CurrentAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext => {
    const auth = ctx.switchToHttp().getRequest<AuthedRequest>().auth;
    if (!auth) {
      throw new AppError('UNAUTHENTICATED');
    }
    return auth;
  },
);

/** Die Identität, falls angemeldet, sonst `undefined` (für öffentliche Routen). */
export const OptionalAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext | undefined =>
    ctx.switchToHttp().getRequest<AuthedRequest>().auth,
);
