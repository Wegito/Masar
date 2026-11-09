import { defineConfig } from 'vitest/config';

// Nur Tests ohne Datenbank: kein globalSetup, keine Dateien aus test/ (die brauchen PostgreSQL).
// Aufruf: pnpm --filter @masar/api test:unit
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    env: { LOG_LEVEL: 'silent' },
    // JUnit-Bericht für Allrounder (.agy-foreman.json): Der Dateipfad im Bericht muss vom
    // Repo-Stamm aus gelten, sonst findet er die Contract-Tests nicht.
    reporters: [
      'default',
      ['junit', { outputFile: 'junit.xml', classnameTemplate: 'apps/api/{filename}' }],
    ],
  },
});
