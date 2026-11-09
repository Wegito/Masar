import { existsSync } from 'node:fs';

import { normalizeEmail } from '@masar/shared';
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../src/generated/prisma/client.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { DEMO_COMPANY_SLUG, seedDemo } from './seed/demo.js';

/**
 * Demo-Daten in die Entwicklungsdatenbank schreiben: pnpm --filter @masar/api db:seed
 *
 * Läuft mit der Anwendungsrolle (DATABASE_URL), weil es nur Daten schreibt. Optional entsteht ein
 * Demo-Konto mit Admin-Rolle in der Demo-Firma, aber nur, wenn SEED_STAFF_EMAIL und
 * SEED_STAFF_PASSWORD gesetzt sind, und ein Plattform-Admin-Konto mit SEED_PLATFORM_ADMIN_EMAIL und
 * SEED_PLATFORM_ADMIN_PASSWORD; im Repo steht kein Passwort. Die Ausgabe nennt nur Zahlen und IDs,
 * keine E-Mail-Adresse.
 */
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}
if (process.env.NODE_ENV === 'production') {
  process.stderr.write('db:seed ist nur für Entwicklung und Tests gedacht.\n');
  process.exit(2);
}
const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined || databaseUrl === '') {
  process.stderr.write('DATABASE_URL fehlt (apps/api/.env, Vorlage .env.example).\n');
  process.exit(2);
}

const MIN_PASSWORD_LENGTH = 12;

async function seedStaff(prisma: PrismaClient, companyId: string): Promise<string | null> {
  const rawEmail = process.env.SEED_STAFF_EMAIL;
  const password = process.env.SEED_STAFF_PASSWORD;
  if (rawEmail === undefined || rawEmail === '' || password === undefined) {
    return null;
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`SEED_STAFF_PASSWORD braucht mindestens ${MIN_PASSWORD_LENGTH} Zeichen.`);
  }
  const email = normalizeEmail(rawEmail);
  const passwordHash = await new PasswordService().hash(password);
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      emailVerifiedAt: new Date(),
      displayName: 'Demo Admin',
      passwordHash,
    },
    select: { id: true },
  });
  await prisma.companyMember.upsert({
    where: { companyId_userId: { companyId, userId: user.id } },
    update: {},
    create: { companyId, userId: user.id, role: 'ADMIN' },
  });
  return user.id;
}

/**
 * Optional ein Plattform-Admin-Konto ohne Firma (Lizenzpflege im Portal, Schritt 2.7), nur mit
 * SEED_PLATFORM_ADMIN_EMAIL und SEED_PLATFORM_ADMIN_PASSWORD. In Produktion entsteht es nur über
 * `pnpm --filter @masar/api admin:create` mit Link zum Setzen des Passworts.
 */
async function seedPlatformAdmin(prisma: PrismaClient): Promise<string | null> {
  const rawEmail = process.env.SEED_PLATFORM_ADMIN_EMAIL;
  const password = process.env.SEED_PLATFORM_ADMIN_PASSWORD;
  if (rawEmail === undefined || rawEmail === '' || password === undefined) {
    return null;
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `SEED_PLATFORM_ADMIN_PASSWORD braucht mindestens ${MIN_PASSWORD_LENGTH} Zeichen.`,
    );
  }
  const email = normalizeEmail(rawEmail);
  const passwordHash = await new PasswordService().hash(password);
  const user = await prisma.user.upsert({
    where: { email },
    update: { isPlatformAdmin: true },
    create: {
      email,
      emailVerifiedAt: new Date(),
      displayName: 'Demo Plattform',
      passwordHash,
      isPlatformAdmin: true,
    },
    select: { id: true },
  });
  return user.id;
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
try {
  const result = await seedDemo(prisma);
  const staffId = await seedStaff(prisma, result.companyId);
  const platformAdminId = await seedPlatformAdmin(prisma);
  process.stdout.write(
    [
      `Demo-Firma ${DEMO_COMPANY_SLUG}: ${result.companyId}`,
      `Fahrten: ${result.tripIds.length} (neu: ${result.createdTrips})`,
      staffId === null
        ? 'Kein Demo-Konto (SEED_STAFF_EMAIL und SEED_STAFF_PASSWORD nicht gesetzt).'
        : `Demo-Konto: ${staffId}`,
      platformAdminId === null
        ? 'Kein Plattform-Admin (SEED_PLATFORM_ADMIN_EMAIL und SEED_PLATFORM_ADMIN_PASSWORD nicht gesetzt).'
        : `Plattform-Admin: ${platformAdminId}`,
      '',
    ].join('\n'),
  );
} finally {
  await prisma.$disconnect();
}
