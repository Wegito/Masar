import { execFileSync } from 'node:child_process';

/** Testdatenbank aus compose.yaml; in CI dieselben Werte über den Service-Container. */
export const TEST_MIGRATE_DATABASE_URL =
  process.env.TEST_MIGRATE_DATABASE_URL ??
  'postgresql://masar_migrate:masar_migrate_dev@localhost:5432/masar_test';

/** Bringt die Testdatenbank vor allen Tests auf den Stand der Migrationen (Migrationsrolle). */
export default function setup(): void {
  try {
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
