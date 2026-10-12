import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { isLocale } from '@masar/shared';
import { PrismaPg } from '@prisma/adapter-pg';

import { validateEnv } from '../config/env.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { grantPlatformAdmin, SETUP_LINK_VALID_HOURS } from './platform-admin.js';

/**
 * Einstieg für die erste Plattform-Admin-Person (docs/betrieb/runbook.md).
 * Aufruf nach dem Build: pnpm --filter @masar/api admin:create --email <adresse> --name <name>
 */
// pnpm reicht ein `--` an das Skript weiter (npm nicht); beide Schreibweisen funktionieren.
const rawArgs = process.argv.slice(2);
const { values } = parseArgs({
  args: rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs,
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    locale: { type: 'string', default: 'ar' },
  },
});
if (values.email === undefined || values.name === undefined || !isLocale(values.locale)) {
  process.stderr.write(
    'Aufruf: admin:create --email <adresse> --name <anzeigename> [--locale ar|en]\n',
  );
  process.exit(2);
}
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}
const env = validateEnv(process.env);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
try {
  const result = await grantPlatformAdmin(prisma, {
    email: values.email,
    displayName: values.name,
    locale: values.locale,
    portalUrl: env.PORTAL_URL,
  });
  process.stdout.write(
    [
      `Plattform-Admin: ${result.userId}`,
      `Link zum Setzen des Passworts (${SETUP_LINK_VALID_HOURS} Stunden gültig, nur einmal nutzbar):`,
      result.setupLink,
      '',
    ].join('\n'),
  );
} finally {
  await prisma.$disconnect();
}
