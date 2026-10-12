import { Global, Injectable, Module } from '@nestjs/common';

import type { RequestContext } from '../../common/request-context.js';
import type { AuditActorType, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';

export interface AuditEntry {
  /** Großgeschrieben, Verb am Ende, z. B. `INVITATION_CREATED`. */
  action: string;
  actorType: AuditActorType;
  actorId?: string | null;
  companyId?: string | null;
  entityType: string;
  entityId?: string | null;
  reason?: string | null;
  /** Nur IDs, Status und Rollen. Nie Namen, Telefonnummern, E-Mail-Adressen oder Tokens. */
  data?: Prisma.InputJsonValue;
}

type AuditWriter = Pick<Prisma.TransactionClient, 'auditLog'>;

/**
 * Schreibt das Audit-Log (nur anhängend, ADR 0016). In einer Transaktion übergibt der Aufrufer
 * deren Client, damit Fachänderung und Eintrag gemeinsam gelingen oder scheitern.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    entry: AuditEntry,
    context: RequestContext,
    writer: AuditWriter = this.prisma,
  ): Promise<void> {
    await writer.auditLog.create({
      data: {
        ...entry,
        requestId: context.requestId ?? null,
        ip: context.ip ?? null,
      },
    });
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
