import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { validate as isUuid } from 'uuid';

import { AppError } from '../../common/app-error.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AuthedRequest } from './auth.types.js';
import { CompanyRoles } from './decorators.js';

/**
 * Prüft die Mitgliedschaft in der Firma aus `:companyId` (ADR 0009, Mandantentrennung). Der
 * Service bekommt die Firma danach nur über diesen geprüften Parameter, nie aus dem Body.
 * Eine fremde Firma ergibt FORBIDDEN, eine ungültige ID NOT_FOUND.
 */
@Injectable()
export class CompanyRoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requirement = this.reflector.getAllAndOverride(CompanyRoles, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (requirement === undefined) {
      return true;
    }
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const auth = req.auth;
    if (!auth) {
      throw new AppError('UNAUTHENTICATED');
    }
    const companyId = req.params['companyId'];
    if (typeof companyId !== 'string' || !isUuid(companyId)) {
      throw new AppError('NOT_FOUND');
    }
    if (requirement.allowPlatformAdmin === true && auth.isPlatformAdmin) {
      return true;
    }
    const membership = await this.prisma.companyMember.findUnique({
      where: { companyId_userId: { companyId, userId: auth.userId } },
      select: { role: true, status: true, company: { select: { status: true } } },
    });
    if (
      !membership ||
      membership.status !== 'ACTIVE' ||
      membership.company.status !== 'ACTIVE' ||
      !requirement.roles.includes(membership.role)
    ) {
      throw new AppError('FORBIDDEN');
    }
    return true;
  }
}
