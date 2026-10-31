import { randomUUID } from 'node:crypto';

import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaClient } from '../src/generated/prisma/client.js';
import { cleanupAuthArtifacts } from '../src/modules/auth/auth-cleanup.js';
import { resetDatabase } from './helpers/app.js';

/**
 * Aufräum-Job für Sitzungen, Reset-Links und Einladungen: löscht nur, was seit mehr als 30 Tagen
 * abgelaufen oder widerrufen ist. Ein Fehler hier würde aktive Anmeldungen beenden.
 */
describe('Aufräumen alter Anmeldedaten', () => {
  let prisma: PrismaClient;
  const now = new Date('2026-11-01T12:00:00Z');
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);
  const daysAhead = (days: number) => new Date(now.getTime() + days * 86_400_000);

  beforeAll(async () => {
    await resetDatabase();
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL as string }),
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('löscht nur, was seit mehr als 30 Tagen abgelaufen oder widerrufen ist', async () => {
    const user = await prisma.user.create({
      data: { email: 'aufraeumen@firma.example', displayName: 'Test' },
    });
    const company = await prisma.company.create({
      data: { slug: 'aufraeumen', nameAr: 'x', nameEn: 'x' },
    });
    const session = (expiresAt: Date, revokedAt: Date | null = null) =>
      prisma.session.create({
        data: { userId: user.id, kind: 'STAFF', tokenHash: randomUUID(), expiresAt, revokedAt },
      });
    const oldExpired = await session(daysAgo(31));
    const recentlyExpired = await session(daysAgo(29));
    const active = await session(daysAhead(1));
    const oldRevoked = await session(daysAhead(1), daysAgo(31));
    const oldReset = await prisma.passwordReset.create({
      data: { userId: user.id, tokenHash: randomUUID(), expiresAt: daysAgo(31) },
    });
    const freshReset = await prisma.passwordReset.create({
      data: { userId: user.id, tokenHash: randomUUID(), expiresAt: daysAgo(1) },
    });
    const invitation = (expiresAt: Date) =>
      prisma.invitation.create({
        data: {
          companyId: company.id,
          email: `${randomUUID()}@firma.example`,
          role: 'AGENT',
          tokenHash: randomUUID(),
          invitedByUserId: user.id,
          expiresAt,
        },
      });
    const oldInvitation = await invitation(daysAgo(31));
    const openInvitation = await invitation(daysAhead(3));

    expect(await cleanupAuthArtifacts(prisma, now)).toBe(4);

    const remainingSessions = (await prisma.session.findMany()).map((s) => s.id).sort();
    expect(remainingSessions).toEqual([recentlyExpired.id, active.id].sort());
    expect(remainingSessions).not.toContain(oldExpired.id);
    expect(remainingSessions).not.toContain(oldRevoked.id);
    expect((await prisma.passwordReset.findMany()).map((r) => r.id)).toEqual([freshReset.id]);
    expect((await prisma.invitation.findMany()).map((i) => i.id)).toEqual([openInvitation.id]);
    expect(oldReset.id).not.toBe(freshReset.id);
    expect(oldInvitation.id).not.toBe(openInvitation.id);

    // Ein zweiter Lauf ändert nichts.
    expect(await cleanupAuthArtifacts(prisma, now)).toBe(0);
  });
});
