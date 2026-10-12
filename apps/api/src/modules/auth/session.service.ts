import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseCookie } from 'cookie';
import type { Request, Response } from 'express';

import { Clock } from '../../common/clock.js';
import type { RequestContext } from '../../common/request-context.js';
import type { Env } from '../../config/env.js';
import type { Prisma, SessionKind } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AuthContext } from './auth.types.js';
import { createToken, hashToken } from './tokens.js';

/** Ohne Aktivität endet eine Sitzung nach 12 Stunden, in jedem Fall nach 30 Tagen. */
export const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;
/** `last_seen_at` wird höchstens alle 5 Minuten geschrieben, nicht bei jeder Anfrage. */
const LAST_SEEN_RESOLUTION_MS = 5 * 60 * 1000;

type SessionWriter = Pick<Prisma.TransactionClient, 'session'>;

/** Opake Sitzungen in PostgreSQL (ADR 0009): sofort widerrufbar, Token nur als Hash gespeichert. */
@Injectable()
export class SessionService {
  private readonly secure: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    config: ConfigService<Env, true>,
  ) {
    this.secure = config.get('SESSION_COOKIE_SECURE', { infer: true });
  }

  /** `__Host-` verlangt Secure und Path=/ ohne Domain: Das Cookie gilt nur für genau diesen Host. */
  get cookieName(): string {
    return this.secure ? '__Host-masar_session' : 'masar_session';
  }

  async create(
    userId: string,
    kind: SessionKind,
    context: RequestContext,
    writer: SessionWriter = this.prisma,
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = createToken();
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_MS);
    await writer.session.create({
      data: {
        userId,
        kind,
        tokenHash: hashToken(token),
        createdAt: now,
        lastSeenAt: now,
        expiresAt,
        ip: context.ip ?? null,
        userAgent: context.userAgent ?? null,
      },
    });
    return { token, expiresAt };
  }

  /** Liefert die Identität oder `null` bei unbekanntem, widerrufenem oder abgelaufenem Token. */
  async resolve(token: string): Promise<AuthContext | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: { select: { status: true, isPlatformAdmin: true } } },
    });
    const now = this.clock.now().getTime();
    if (
      !session ||
      session.revokedAt !== null ||
      session.expiresAt.getTime() <= now ||
      now - session.lastSeenAt.getTime() > SESSION_IDLE_MS ||
      session.user.status !== 'ACTIVE'
    ) {
      return null;
    }
    if (now - session.lastSeenAt.getTime() > LAST_SEEN_RESOLUTION_MS) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date(now) },
      });
    }
    return {
      userId: session.userId,
      sessionId: session.id,
      isPlatformAdmin: session.user.isPlatformAdmin,
    };
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: this.clock.now() },
    });
  }

  async revokeAllForUser(userId: string, writer: SessionWriter = this.prisma): Promise<number> {
    const result = await writer.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: this.clock.now() },
    });
    return result.count;
  }

  /** Token aus `Authorization: Bearer` (spätere native App) oder aus dem Cookie (Web). */
  tokenFrom(req: Request): string | undefined {
    const authorization = req.headers.authorization;
    if (authorization?.startsWith('Bearer ')) {
      const token = authorization.slice('Bearer '.length).trim();
      return token === '' ? undefined : token;
    }
    return parseCookie(req.headers.cookie ?? '')[this.cookieName];
  }

  setCookie(res: Response, token: string, expiresAt: Date): void {
    res.cookie(this.cookieName, token, {
      httpOnly: true,
      secure: this.secure,
      sameSite: 'lax',
      path: '/',
      maxAge: Math.max(0, expiresAt.getTime() - this.clock.now().getTime()),
    });
  }

  clearCookie(res: Response): void {
    res.clearCookie(this.cookieName, {
      httpOnly: true,
      secure: this.secure,
      sameSite: 'lax',
      path: '/',
    });
  }
}
