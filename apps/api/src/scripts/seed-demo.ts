import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { localDateInDamascus } from '@masar/shared';
import { PrismaPg } from '@prisma/adapter-pg';

import { validateEnv } from '../config/env.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { assertSeedAllowed, grantDemoAgent, seedDemo } from './demo-data.js';

/**
 * Füllt die Entwicklungsdatenbank mit Demo-Daten (fiktive Firma, Fahrten ab heute).
 * Aufruf nach dem Build: pnpm --filter @masar/api db:seed [--days 7] [--agent-email <adresse>]
 */
const rawArgs = process.argv.slice(2);
const { values } = parseArgs({
  args: rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs,
  options: {
    days: { type: 'string', default: '7' },
    'agent-email': { type: 'string' },
  },
});
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}
const env = validateEnv(process.env);
assertSeedAllowed(env);

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
try {
  const result = await seedDemo(prisma, {
    today: localDateInDamascus(new Date()),
    days: Number(values.days),
  });
  process.stdout.write(
    `Demo-Firma ${result.companyId}: ${result.tripsCreated} Fahrten angelegt, ` +
      `${result.tripsExisting} bestanden schon.\n`,
  );
  const agentEmail = values['agent-email'];
  if (agentEmail !== undefined) {
    const agent = await grantDemoAgent(prisma, { email: agentEmail, portalUrl: env.PORTAL_URL });
    process.stdout.write(
      [
        `Agent der Demo-Firma: ${agent.userId}`,
        `Link zum Setzen des Passworts (24 Stunden gültig, nur einmal nutzbar):`,
        agent.setupLink,
        '',
      ].join('\n'),
    );
  }
} finally {
  await prisma.$disconnect();
}
