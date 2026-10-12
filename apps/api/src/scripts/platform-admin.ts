import { type Locale, normalizeEmail } from '@masar/shared';

import type { PrismaClient } from '../generated/prisma/client.js';
import { createToken, hashToken } from '../modules/auth/tokens.js';

export const SETUP_LINK_VALID_HOURS = 24;

/**
 * Macht eine Adresse zur Plattform-Admin-Person: legt das Konto an oder erweitert ein bestehendes,
 * und erzeugt einen einmaligen Link zum Setzen des Passworts (derselbe Weg wie Passwort-Reset).
 * Das Passwort selbst sieht niemand außer der Person, die den Link öffnet.
 */
export async function grantPlatformAdmin(
  prisma: PrismaClient,
  input: { email: string; displayName: string; locale: Locale; portalUrl: string; now?: Date },
): Promise<{ userId: string; setupLink: string }> {
  const email = normalizeEmail(input.email);
  const now = input.now ?? new Date();
  const token = createToken();
  const user = await prisma.$transaction(async (tx) => {
    const account = await tx.user.upsert({
      where: { email },
      update: { isPlatformAdmin: true },
      create: {
        email,
        displayName: input.displayName,
        isPlatformAdmin: true,
        emailVerifiedAt: now,
        preferredLocale: input.locale,
      },
      select: { id: true, preferredLocale: true },
    });
    await tx.passwordReset.create({
      data: {
        userId: account.id,
        tokenHash: hashToken(token),
        createdAt: now,
        expiresAt: new Date(now.getTime() + SETUP_LINK_VALID_HOURS * 3_600_000),
      },
    });
    await tx.auditLog.create({
      data: {
        action: 'PLATFORM_ADMIN_GRANTED',
        actorType: 'SYSTEM',
        entityType: 'user',
        entityId: account.id,
        reason: 'Skript create-platform-admin',
      },
    });
    return account;
  });
  return {
    userId: user.id,
    setupLink: `${input.portalUrl}/${user.preferredLocale}/auth/reset-password#token=${token}`,
  };
}
