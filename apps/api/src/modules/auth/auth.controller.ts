import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { requestContext } from '../../common/request-context.js';
import {
  type LoginInput,
  loginSchema,
  type PasswordResetConfirmInput,
  passwordResetConfirmSchema,
  type PasswordResetRequestInput,
  passwordResetRequestSchema,
} from './auth.schemas.js';
import { AuthService, type UserSummary } from './auth.service.js';
import type { AuthContext } from './auth.types.js';
import { CurrentAuth, Public } from './decorators.js';
import { SessionService } from './session.service.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(
    @Body({ schema: loginSchema }) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: UserSummary }> {
    const result = await this.auth.login(body, requestContext(req));
    this.sessions.setCookie(res, result.token, result.expiresAt);
    return { user: result.user };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(auth, requestContext(req));
    this.sessions.clearCookie(res);
  }

  @Get('me')
  async me(@CurrentAuth() auth: AuthContext): Promise<{ user: UserSummary }> {
    return { user: await this.auth.summary(auth.userId) };
  }

  @Public()
  @Post('password-reset/request')
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } })
  async requestPasswordReset(
    @Body({ schema: passwordResetRequestSchema }) body: PasswordResetRequestInput,
    @Req() req: Request,
  ): Promise<Record<string, never>> {
    await this.auth.requestPasswordReset(body.email, requestContext(req));
    return {};
  }

  @Public()
  @Post('password-reset/confirm')
  @HttpCode(204)
  @Throttle({ default: { limit: 10, ttl: 15 * 60_000 } })
  async confirmPasswordReset(
    @Body({ schema: passwordResetConfirmSchema }) body: PasswordResetConfirmInput,
    @Req() req: Request,
  ): Promise<void> {
    await this.auth.confirmPasswordReset(body.token, body.password, requestContext(req));
  }
}
