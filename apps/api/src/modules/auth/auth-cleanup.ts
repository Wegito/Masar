import type { PrismaClient } from '../../generated/prisma/client.js';

/** Aufbewahrung nach Ablauf (docs/offene-entscheidungen.md, Aufräumen von Sitzungen). */
export const AUTH_ARTIFACT_RETENTION_DAYS = 30;

/**
 * Löscht Sitzungen, Reset-Links und Einladungen 30 Tage nach Ablauf oder Widerruf. Sitzungen und
 * Reset-Links tragen IP und User-Agent; sie sollen nicht unbegrenzt liegen bleiben. Wer wen
 * eingeladen hat, steht weiter im Audit-Log. Liefert die Zahl gelöschter Zeilen.
 */
export async function cleanupAuthArtifacts(prisma: PrismaClient, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - AUTH_ARTIFACT_RETENTION_DAYS * 86_400_000);
  const [sessions, resets, invitations] = await prisma.$transaction([
    prisma.session.deleteMany({
      where: { OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] },
    }),
    prisma.passwordReset.deleteMany({ where: { expiresAt: { lt: cutoff } } }),
    prisma.invitation.deleteMany({ where: { expiresAt: { lt: cutoff } } }),
  ]);
  return sessions.count + resets.count + invitations.count;
}
