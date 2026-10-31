import { execFileSync } from 'node:child_process';

import pg from 'pg';

/** Testdatenbank aus compose.yaml; in CI dieselben Werte über den Service-Container. */
export const TEST_MIGRATE_DATABASE_URL =
  process.env.TEST_MIGRATE_DATABASE_URL ??
  'postgresql://masar_migrate:masar_migrate_dev@localhost:5432/masar_test';

/**
 * Leert alle Tabellen vor der Migration. Testdaten sind Wegwerfdaten; liegen alte Zeilen herum,
 * kann eine neue Migration mit zusätzlichem Constraint daran scheitern (beobachtet 2026-10-31:
 * Fremdschlüssel auf booking gegen Belegungen aus älteren Testläufen). Prisma führt eine Migration
 * nicht atomar aus, ein Fehler hinterlässt die Datenbank halb migriert.
 */
async function truncateAllTables(): Promise<void> {
  const client = new pg.Client({ connectionString: TEST_MIGRATE_DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{ name: string }>(
      `SELECT format('%I', tablename) AS name FROM pg_tables
       WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
    );
    if (rows.length > 0) {
      await client.query(`TRUNCATE ${rows.map((r) => r.name).join(', ')} RESTART IDENTITY CASCADE`);
    }
  } finally {
    await client.end();
  }
}

/** Bringt die Testdatenbank vor allen Tests auf den Stand der Migrationen (Migrationsrolle). */
export default async function setup(): Promise<void> {
  try {
    await truncateAllTables();
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      env: {
        ...process.env,
        MIGRATE_DATABASE_URL: TEST_MIGRATE_DATABASE_URL,
        PRISMA_HIDE_UPDATE_MESSAGE: '1',
      },
      stdio: 'pipe',
    });
  } catch (error) {
    const output = (error as { stdout?: Buffer }).stdout?.toString() ?? '';
    throw new Error(
      `Migration der Testdatenbank fehlgeschlagen. Läuft "docker compose up -d postgres"?\n${output}`,
      { cause: error },
    );
  }
}
