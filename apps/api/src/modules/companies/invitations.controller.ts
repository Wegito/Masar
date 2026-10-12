import { Body, Controller, Param, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { requestContext } from '../../common/request-context.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CompanyRoles, CurrentAuth, OptionalAuth, Public } from '../auth/decorators.js';
import { SessionService } from '../auth/session.service.js';
import {
  type AcceptInvitationInput,
  acceptInvitationSchema,
  type CreateInvitationInput,
  createInvitationSchema,
} from './invitations.schemas.js';
import { InvitationsService } from './invitations.service.js';

@Controller()
export class InvitationsController {
  constructor(
    private readonly invitations: InvitationsService,
    private readonly sessions: SessionService,
  ) {}

  @Post('companies/:companyId/invitations')
  @CompanyRoles({ roles: ['ADMIN'], allowPlatformAdmin: true })
  create(
    @Param('companyId') companyId: string,
    @Body({ schema: createInvitationSchema }) body: CreateInvitationInput,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
  ): ReturnType<InvitationsService['create']> {
    return this.invitations.create(companyId, body, auth, requestContext(req));
  }

  @Public()
  @Post('invitations/accept')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async accept(
    @Body({ schema: acceptInvitationSchema }) body: AcceptInvitationInput,
    @OptionalAuth() auth: AuthContext | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ companyId: string; userId: string }> {
    const result = await this.invitations.accept(body, auth, requestContext(req));
    if (result.created) {
      this.sessions.setCookie(res, result.session.token, result.session.expiresAt);
      res.status(201);
    } else {
      res.status(200);
    }
    return { companyId: result.companyId, userId: result.userId };
  }
}
