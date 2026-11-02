import { defineConfig } from 'vitest/config';

// Nur Tests ohne Datenbank: kein globalSetup, keine Dateien aus test/ (die brauchen PostgreSQL).
// Aufruf: pnpm --filter @masar/api test:unit
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    env: { LOG_LEVEL: 'silent' },
  },
});
