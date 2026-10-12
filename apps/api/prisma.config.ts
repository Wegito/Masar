import { existsSync } from 'node:fs';

import { defineConfig } from 'prisma/config';

// Prisma 7 lädt .env nicht mehr selbst; Node kann es seit Version 20.12.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

/**
 * Konfiguration der Prisma-CLI. Migrationen laufen mit der Migrationsrolle (DDL-Rechte); die
 * Anwendung selbst verbindet sich mit der Anwendungsrolle (siehe src/prisma/prisma.service.ts).
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    url: process.env.MIGRATE_DATABASE_URL ?? '',
    // Feste Schattendatenbank: Die Migrationsrolle braucht kein CREATEDB, und CI kann Migrationen
    // gegen das Schema abgleichen.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
