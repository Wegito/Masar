import { normalizeEmail } from '@masar/shared';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AppError } from '../../common/app-error.js';
import { Clock } from '../../common/clock.js';
import { errorSummary } from '../../common/logging.js';
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
  /** Laufende Passwort-Resets, die nach der Antwort an den Client weiterarbeiten. */
  private readonly pendingResets = new Set<Promise<void>>();

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
   * Anmeldung von Personal. Unbekannte Adresse, falsches Passwort, deaktiviertes und gesperrtes
   * Konto ergeben dieselbe Antwort (INVALID_CREDENTIALS) und denselben Argon2-Aufwand. Nach
   * mehreren Fehlversuchen greift eine wachsende Wartezeit je Konto; sie zeigt sich nicht nach
   * außen, denn eine eigene Antwort verriete, dass es zur Adresse ein Konto gibt (ADR 0009,
   * Nachtrag 2026-11-02). Während der Wartezeit scheitert auch das richtige Passwort.
   */
  async login(
    input: { email: string; password: string },
    context: RequestContext,
  ): Promise<{ token: string; expiresAt: Date; user: UserSummary }> {
    const user = await this.prisma.user.findUnique({
      where: { email: normalizeEmail(input.email) },
      select: { id: true, passwordHash: true, status: true },
    });
    const now = this.clock.now();
    // Der Versuch wird vor der Argon2-Prüfung reserviert. Parallele Anfragen sehen so die Wartezeit,
    // die ein früherer Versuch ausgelöst hat, und bekommen keine echte Prüfung mehr.
    const attempt = user ? await this.reserveLoginAttempt(user.id, now) : null;
    const valid =
      user?.passwordHash != null && user.status === 'ACTIVE' && attempt !== null
        ? await this.passwords.verify(user.passwordHash, input.password)
        : await this.passwords.verifyDummy(input.password);
    if (!user || !valid) {
      // Versuche während der Wartezeit zählen nicht: Die Wartezeit wächst nur nach ihrem Ablauf.
      if (user && attempt !== null) {
        await this.recordFailedLogin(user.id, attempt, context);
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

  /**
   * Reserviert einen Login-Versuch unter der Sperre der Kontozeile: frisch lesen, prüfen, schreiben.
   * Läuft keine Wartezeit, zählt der Versuch vorab als Fehlversuch und setzt die Wartezeit, die bei
   * einem Fehlschlag gälte; eine erfolgreiche Anmeldung setzt beides danach zurück. Gibt `null`
   * zurück, wenn die Wartezeit läuft. `lockedUntil` wird nur verlängert, nie verkürzt.
   */
  private async reserveLoginAttempt(
    userId: string,
    now: Date,
  ): Promise<{ failedLogins: number; lockMs: number } | null> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ failedLogins: number; lockedUntil: Date | null }[]>`
        SELECT failed_logins AS "failedLogins", locked_until AS "lockedUntil"
        FROM "user" WHERE id = ${userId}::uuid FOR UPDATE`;
      const row = rows[0];
      if (!row || (row.lockedUntil !== null && row.lockedUntil > now)) {
        return null;
      }
      const failedLogins = row.failedLogins + 1;
      const lockMs = lockDurationMs(failedLogins);
      const lockedUntil =
        lockMs > 0
          ? new Date(Math.max(now.getTime() + lockMs, row.lockedUntil?.getTime() ?? 0))
          : row.lockedUntil;
      await tx.user.update({ where: { id: userId }, data: { failedLogins, lockedUntil } });
      return { failedLogins, lockMs };
    });
  }

  private async recordFailedLogin(
    userId: string,
    attempt: { failedLogins: number; lockMs: number },
    context: RequestContext,
  ): Promise<void> {
    // Zähler und Wartezeit stehen schon seit der Reservierung fest; hier fehlt nur der Audit-Eintrag.
    await this.audit.record(
      {
        action: 'LOGIN_FAILED',
        actorType: 'USER',
        actorId: userId,
        entityType: 'user',
        entityId: userId,
        data: { failedLogins: attempt.failedLogins, lockedForSeconds: attempt.lockMs / 1000 },
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
   * Startet einen Passwort-Reset und kehrt sofort zurück, ohne auf Datenbank oder Versand zu
   * warten. Antwort und Antwortzeit sind damit für bekannte und unbekannte Adressen gleich; es
   * bleibt kein Zeitkanal (ADR 0009, Nachtrag 2026-11-02). Je Konto höchstens ein Link pro Minute.
   */
  requestPasswordReset(emailInput: string, context: RequestContext): void {
    const email = normalizeEmail(emailInput);
    const task = this.issuePasswordReset(email, context).catch((error: unknown) => {
      // Nur Klasse und Code: Meldungen von Prisma können die gesuchte Adresse wiedergeben.
      this.logger.error({ error: errorSummary(error) }, 'Passwort-Reset nicht verarbeitet');
    });
    this.pendingResets.add(task);
    void task.finally(() => this.pendingResets.delete(task));
  }

  /** Wartet auf alle angestoßenen Passwort-Resets. Für Tests; die Anfrage selbst wartet nie. */
  async settled(): Promise<void> {
    await Promise.all(this.pendingResets);
  }

  private async issuePasswordReset(email: string, context: RequestContext): Promise<void> {
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
    try {
      await this.mailer.send({ to: email, ...mail });
    } catch (error: unknown) {
      // Nur Klasse und Code: Die Meldung des Mailservers enthält oft die Empfängeradresse.
      this.logger.error({ error: errorSummary(error) }, 'Mail für Passwort-Reset nicht zugestellt');
    }
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
