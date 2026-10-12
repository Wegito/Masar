import { defineConfig, devices } from '@playwright/test';

import {
  API_DIR,
  API_URL,
  PORTAL_DIR,
  PORTAL_URL,
  TEST_DATABASE_URL,
  WEB_DIR,
  WEB_URL,
} from './support/env';

/**
 * Ende-zu-Ende-Tests gegen die gebauten Apps (API, Web, Portal) mit der Testdatenbank. Ein
 * gemeinsamer Lauf, weil alle Apps dieselbe API und Datenbank brauchen; getrennte Läufe je App
 * würden um Ports und Testdaten konkurrieren. Laufen auf den Ports schon Server, bricht Playwright
 * ab, statt mit der falschen Datenbank zu testen.
 * Aufruf im Wurzelordner: docker compose up -d --wait, dann pnpm test:e2e (baut vorher).
 */
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: process.env.CI !== undefined,
  reporter: process.env.CI === undefined ? [['list']] : [['list'], ['github']],
  globalSetup: './global-setup.ts',
  use: { trace: 'retain-on-failure' },
  projects: [
    // Die Fahrgast-App ist mobile-first; sie wird auf einem Smartphone-Viewport geprüft.
    { name: 'web', testMatch: /web\.spec\.ts$/, use: { ...devices['Pixel 7'], baseURL: WEB_URL } },
    {
      name: 'portal',
      testMatch: /portal\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], baseURL: PORTAL_URL },
    },
  ],
  webServer: [
    {
      command: 'node --enable-source-maps dist/main.js',
      cwd: API_DIR,
      url: `${API_URL}/api/health/ready`,
      reuseExistingServer: false,
      env: {
        PORT: '3001',
        DATABASE_URL: TEST_DATABASE_URL,
        LOG_LEVEL: 'warn',
        NODE_ENV: 'production',
        TRUST_PROXY: '0',
      },
    },
    { command: 'pnpm start', cwd: WEB_DIR, url: `${WEB_URL}/ar`, reuseExistingServer: false },
    {
      command: 'pnpm start',
      cwd: PORTAL_DIR,
      url: `${PORTAL_URL}/ar/auth/login`,
      reuseExistingServer: false,
    },
  ],
});
