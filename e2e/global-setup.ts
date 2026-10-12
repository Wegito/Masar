import { execFileSync } from 'node:child_process';

import { API_DIR, TEST_MIGRATE_DATABASE_URL } from './support/env';

/**
 * Testdatenbank auf den Stand der Migrationen bringen (Migrationsrolle), wie die API-Tests.
 * Playwright startet die Server vor diesem Schritt (beobachtet in Version 1.64). Das geht, weil
 * die Readiness der API nur die Verbindung prüft; die Tests selbst laufen erst danach.
 */
export default function globalSetup(): void {
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: API_DIR,
    env: {
      ...process.env,
      MIGRATE_DATABASE_URL: TEST_MIGRATE_DATABASE_URL,
      PRISMA_HIDE_UPDATE_MESSAGE: '1',
    },
    stdio: 'pipe',
  });
}
