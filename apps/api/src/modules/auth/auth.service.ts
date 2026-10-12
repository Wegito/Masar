import { normalizeEmail } from '@masar/shared';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AppError } from '../../common/app-error.js';
import { Clock } from '../../common/clock.js';
import type { RequestContext } from '../../common/request-context.js';
import type { Env } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { Mailer } from '../mail/mailer.js';
import { passwordResetMail } from '../mail/templates.js';
import type { AuthContext } from './auth.types.js';
import { lockDurationMs } from './domain/lockout.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';
import { createToken, hashToken } from './tokens.js';

export const PASSWORD_RESET_VALID_MINUTES = 30;

export interface UserSummary {
  id: string;
  email: string | null;
  displayName: string;
  preferredLocale: 'ar' | 'en';
  isPlatformAdmin: boolean;
  memberships: {
    companyId: string;
    companySlug: string;
    companyNameAr: string;
    companyNameEn: string;
    role: 'ADMIN' | 'AGENT' | 'DRIVER';
  }[];
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly portalUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly mailer: Mailer,
    private readonly clock: Clock,
    config: ConfigService<Env, true>,
  ) {
    this.portalUrl = config.get('PORTAL_URL', { infer: true });
  }

  /**
   * Anmeldung von Personal. Unbekannte Adresse, falsches Passwort und deaktiviertes Konto ergeben
   * dieselbe Antwort und denselben Rechenaufwand. Nach mehreren Fehlversuchen greift eine
   * wachsende Wartezeit je Konto (LOGIN_THROTTLED mit Retry-After).
   */
  async login(
    input: { email: string; password: string },
    context: RequestContext,
  ): Promise<{ token: string; expiresAt: Date; user: UserSummary }> {
    const user = await this.prisma.user.findUnique({
      where: { email: normalizeEmail(input.email) },
      select: { id: true, passwordHash: true, status: true, lockedUntil: true },
    });
    const now = this.clock.now();
    if (user?.lockedUntil && user.lockedUntil > now) {
      const seconds = Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 1000);
      throw new AppError('LOGIN_THROTTLED', { headers: { 'Retry-After': String(seconds) } });
    }
    const valid =
      user?.passwordHash != null && user.status === 'ACTIVE'
        ? await this.passwords.verify(user.passwordHash, input.password)
        : await this.passwords.verifyDummy(input.password);
    if (!user || !valid) {
      if (user) {
        await this.recordFailedLogin(user.id, now, context);
      }
      throw new AppError('INVALID_CREDENTIALS');
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null, lastLoginAt: now },
    });
    const session = await this.sessions.create(user.id, 'STAFF', context);
    await this.audit.record(
      {
        action: 'LOGIN_SUCCEEDED',
        actorType: 'USER',
        actorId: user.id,
        entityType: 'user',
        entityId: user.id,
      },
      context,
    );
    return { ...session, user: await this.summary(user.id) };
  }

  private async recordFailedLogin(
    userId: string,
    now: Date,
    context: RequestContext,
  ): Promise<void> {
    // Atomar hochzählen: Parallele Fehlversuche dürfen sich nicht gegenseitig überschreiben.
    const { failedLogins } = await this.prisma.user.update({
      where: { id: userId },
      data: { failedLogins: { increment: 1 } },
      select: { failedLogins: true },
    });
    const lockMs = lockDurationMs(failedLogins);
    if (lockMs > 0) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { lockedUntil: new Date(now.getTime() + lockMs) },
      });
    }
    await this.audit.record(
      {
        action: 'LOGIN_FAILED',
        actorType: 'USER',
        actorId: userId,
        entityType: 'user',
        entityId: userId,
        data: { failedLogins, lockedForSeconds: lockMs / 1000 },
      },
      context,
    );
  }

  async logout(auth: AuthContext, context: RequestContext): Promise<void> {
    await this.sessions.revoke(auth.sessionId);
    await this.audit.record(
      {
        action: 'LOGOUT',
        actorType: 'USER',
        actorId: auth.userId,
        entityType: 'session',
        entityId: auth.sessionId,
      },
      context,
    );
  }

  async summary(userId: string): Promise<UserSummary> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        preferredLocale: true,
        isPlatformAdmin: true,
        memberships: {
          where: { status: 'ACTIVE', company: { status: 'ACTIVE' } },
          orderBy: { createdAt: 'asc' },
          select: {
            role: true,
            company: { select: { id: true, slug: true, nameAr: true, nameEn: true } },
          },
        },
      },
    });
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      preferredLocale: user.preferredLocale,
      isPlatformAdmin: user.isPlatformAdmin,
      memberships: user.memberships.map((membership) => ({
        companyId: membership.company.id,
        companySlug: membership.company.slug,
        companyNameAr: membership.company.nameAr,
        companyNameEn: membership.company.nameEn,
        role: membership.role,
      })),
    };
  }

  /**
   * Startet einen Passwort-Reset. Die Antwort ist immer gleich, damit sich nicht prüfen lässt,
   * welche Adressen ein Konto haben. Je Konto höchstens ein neuer Link pro Minute.
   */
  async requestPasswordReset(emailInput: string, context: RequestContext): Promise<void> {
    const email = normalizeEmail(emailInput);
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, status: true, preferredLocale: true },
    });
    if (!user || user.status !== 'ACTIVE') {
      return;
    }
    const now = this.clock.now();
    const recent = await this.prisma.passwordReset.count({
      where: { userId: user.id, createdAt: { gt: new Date(now.getTime() - 60_000) } },
    });
    if (recent > 0) {
      return;
    }
    const token = createToken();
    await this.prisma.$transaction(async (tx) => {
      await tx.passwordReset.create({
        data: {
          userId: user.id,
          createdAt: now,
          tokenHash: hashToken(token),
          expiresAt: new Date(now.getTime() + PASSWORD_RESET_VALID_MINUTES * 60_000),
          requestedIp: context.ip ?? null,
        },
      });
      await this.audit.record(
        {
          action: 'PASSWORD_RESET_REQUESTED',
          actorType: 'GUEST',
          entityType: 'user',
          entityId: user.id,
        },
        context,
        tx,
      );
    });
    // Das Token steht im Fragment (#), damit es nie in Server-Logs oder im Referer landet.
    const link = `${this.portalUrl}/${user.preferredLocale}/auth/reset-password#token=${token}`;
    const mail = passwordResetMail({
      locale: user.preferredLocale,
      link,
      validMinutes: PASSWORD_RESET_VALID_MINUTES,
    });
    // Nicht abwarten: Sonst verrät die Antwortzeit, ob es das Konto gibt.
    void this.mailer.send({ to: email, ...mail }).catch((error: unknown) => {
      this.logger.error({ err: error }, 'Mail für Passwort-Reset nicht zugestellt');
    });
  }

  /** Setzt das neue Passwort, verbraucht alle offenen Links und meldet alle Sitzungen ab. */
  async confirmPasswordReset(
    token: string,
    password: string,
    context: RequestContext,
  ): Promise<void> {
    const now = this.clock.now();
    const reset = await this.prisma.passwordReset.findUnique({
      where: { tokenHash: hashToken(token) },
      select: {
        id: true,
        userId: true,
        usedAt: true,
        expiresAt: true,
        user: { select: { status: true } },
      },
    });
    if (
      !reset ||
      reset.usedAt !== null ||
      reset.expiresAt <= now ||
      reset.user.status !== 'ACTIVE'
    ) {
      throw new AppError('PASSWORD_RESET_INVALID');
    }
    const passwordHash = await this.passwords.hash(password);
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.passwordReset.updateMany({
        where: { id: reset.id, usedAt: null },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) {
        throw new AppError('PASSWORD_RESET_INVALID');
      }
      await tx.user.update({
        where: { id: reset.userId },
        data: { passwordHash, failedLogins: 0, lockedUntil: null },
      });
      await tx.passwordReset.updateMany({
        where: { userId: reset.userId, usedAt: null },
        data: { usedAt: now },
      });
      const sessionsRevoked = await this.sessions.revokeAllForUser(reset.userId, tx);
      await this.audit.record(
        {
          action: 'PASSWORD_RESET_COMPLETED',
          actorType: 'USER',
          actorId: reset.userId,
          entityType: 'user',
          entityId: reset.userId,
          data: { sessionsRevoked },
        },
        context,
        tx,
      );
    });
  }
}
