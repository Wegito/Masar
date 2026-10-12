import { normalizeEmail } from '@masar/shared';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AppError, type FieldError } from '../../common/app-error.js';
import { Clock } from '../../common/clock.js';
import type { RequestContext } from '../../common/request-context.js';
import type { Env } from '../../config/env.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { PasswordService } from '../auth/password.service.js';
import { SessionService } from '../auth/session.service.js';
import { createToken, hashToken } from '../auth/tokens.js';
import { Mailer } from '../mail/mailer.js';
import { invitationMail } from '../mail/templates.js';
import type { AcceptInvitationInput, CreateInvitationInput } from './invitations.schemas.js';

export const INVITATION_VALID_HOURS = 72;

export type AcceptInvitationResult =
  | {
      created: true;
      companyId: string;
      userId: string;
      session: { token: string; expiresAt: Date };
    }
  | { created: false; companyId: string; userId: string };

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);
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
   * Lädt eine Adresse in die Firma ein. Offene frühere Einladungen derselben Adresse werden
   * widerrufen, damit nur der neueste Link gilt. `companyId` stammt aus der geprüften Route.
   */
  async create(
    companyId: string,
    input: CreateInvitationInput,
    actor: AuthContext,
    context: RequestContext,
  ): Promise<{
    invitation: { id: string; email: string; role: string; expiresAt: Date };
    emailDelivered: boolean;
  }> {
    const email = normalizeEmail(input.email);
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { status: true, nameAr: true, nameEn: true },
    });
    if (!company || company.status !== 'ACTIVE') {
      throw new AppError('NOT_FOUND');
    }
    const alreadyMember = await this.prisma.companyMember.findFirst({
      where: { companyId, status: 'ACTIVE', user: { email } },
      select: { id: true },
    });
    if (alreadyMember) {
      throw new AppError('ALREADY_MEMBER');
    }
    const token = createToken();
    const now = this.clock.now();
    const locale = input.locale ?? 'ar';
    const invitation = await this.prisma.$transaction(async (tx) => {
      await tx.invitation.updateMany({
        where: { companyId, email, acceptedAt: null, revokedAt: null },
        data: { revokedAt: now },
      });
      const created = await tx.invitation.create({
        data: {
          companyId,
          email,
          role: input.role,
          tokenHash: hashToken(token),
          invitedByUserId: actor.userId,
          locale,
          expiresAt: new Date(now.getTime() + INVITATION_VALID_HOURS * 3_600_000),
        },
        select: { id: true, email: true, role: true, expiresAt: true },
      });
      await this.audit.record(
        {
          action: 'INVITATION_CREATED',
          actorType: 'USER',
          actorId: actor.userId,
          companyId,
          entityType: 'invitation',
          entityId: created.id,
          data: { role: input.role },
        },
        context,
        tx,
      );
      return created;
    });

    // Das Token steht im Fragment (#), damit es nie in Server-Logs oder im Referer landet.
    const mail = invitationMail({
      locale,
      companyName: locale === 'ar' ? company.nameAr : company.nameEn,
      role: input.role,
      link: `${this.portalUrl}/${locale}/auth/accept-invitation#token=${token}`,
      validHours: INVITATION_VALID_HOURS,
    });
    const emailDelivered = await this.mailer.send({ to: email, ...mail }).then(
      () => true,
      (error: unknown) => {
        this.logger.error(
          { err: error, invitationId: invitation.id },
          'Einladung nicht zugestellt',
        );
        return false;
      },
    );
    return { invitation, emailDelivered };
  }

  /**
   * Nimmt eine Einladung an. Ohne Konto entsteht eines (Name und Passwort nötig) samt Sitzung.
   * Gibt es die Adresse schon, muss genau diese Person angemeldet sein: Ein Einladungslink darf nie
   * das Passwort eines bestehenden Kontos setzen.
   */
  async accept(
    input: AcceptInvitationInput,
    auth: AuthContext | undefined,
    context: RequestContext,
  ): Promise<AcceptInvitationResult> {
    const now = this.clock.now();
    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash: hashToken(input.token) },
      select: {
        id: true,
        companyId: true,
        email: true,
        role: true,
        locale: true,
        acceptedAt: true,
        revokedAt: true,
        expiresAt: true,
        company: { select: { status: true } },
      },
    });
    if (
      !invitation ||
      invitation.acceptedAt !== null ||
      invitation.revokedAt !== null ||
      invitation.expiresAt <= now ||
      invitation.company.status !== 'ACTIVE'
    ) {
      throw new AppError('INVITATION_INVALID');
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email: invitation.email },
      select: { id: true },
    });
    if (existingUser) {
      if (auth?.userId !== existingUser.id) {
        throw new AppError('UNAUTHENTICATED', { detail: 'Log in as the invited user to accept.' });
      }
      await this.prisma.$transaction(async (tx) => {
        await this.claim(tx, invitation.id, now);
        const membership = await tx.companyMember.findUnique({
          where: { companyId_userId: { companyId: invitation.companyId, userId: existingUser.id } },
          select: { id: true, status: true },
        });
        if (membership?.status === 'ACTIVE') {
          throw new AppError('ALREADY_MEMBER');
        }
        if (membership) {
          await tx.companyMember.update({
            where: { id: membership.id },
            data: { status: 'ACTIVE', role: invitation.role },
          });
        } else {
          await tx.companyMember.create({
            data: {
              companyId: invitation.companyId,
              userId: existingUser.id,
              role: invitation.role,
            },
          });
        }
        await this.recordAccepted(tx, invitation, existingUser.id, false, context);
      });
      return { created: false, companyId: invitation.companyId, userId: existingUser.id };
    }

    const missing: FieldError[] = [];
    if (input.displayName === undefined) missing.push({ path: 'displayName', rule: 'required' });
    if (input.password === undefined) missing.push({ path: 'password', rule: 'required' });
    if (input.displayName === undefined || input.password === undefined) {
      throw new AppError('VALIDATION_FAILED', { errors: missing });
    }
    const passwordHash = await this.passwords.hash(input.password);
    const displayName = input.displayName;
    return this.prisma.$transaction(async (tx) => {
      await this.claim(tx, invitation.id, now);
      const user = await tx.user.create({
        data: {
          email: invitation.email,
          // Der Link kam an genau diese Adresse: Sie gilt damit als bestätigt.
          emailVerifiedAt: now,
          displayName,
          passwordHash,
          preferredLocale: invitation.locale,
        },
        select: { id: true },
      });
      await tx.companyMember.create({
        data: { companyId: invitation.companyId, userId: user.id, role: invitation.role },
      });
      await this.recordAccepted(tx, invitation, user.id, true, context);
      const session = await this.sessions.create(user.id, 'STAFF', context, tx);
      return { created: true, companyId: invitation.companyId, userId: user.id, session };
    });
  }

  /** Verbraucht die Einladung atomar; bei gleichzeitigen Versuchen gewinnt genau einer. */
  private async claim(
    tx: Prisma.TransactionClient,
    invitationId: string,
    now: Date,
  ): Promise<void> {
    const claimed = await tx.invitation.updateMany({
      where: { id: invitationId, acceptedAt: null, revokedAt: null },
      data: { acceptedAt: now },
    });
    if (claimed.count !== 1) {
      throw new AppError('INVITATION_INVALID');
    }
  }

  private async recordAccepted(
    tx: Prisma.TransactionClient,
    invitation: { id: string; companyId: string; role: string },
    userId: string,
    userCreated: boolean,
    context: RequestContext,
  ): Promise<void> {
    await this.audit.record(
      {
        action: 'INVITATION_ACCEPTED',
        actorType: 'USER',
        actorId: userId,
        companyId: invitation.companyId,
        entityType: 'invitation',
        entityId: invitation.id,
        data: { role: invitation.role, userCreated },
      },
      context,
      tx,
    );
  }
}
