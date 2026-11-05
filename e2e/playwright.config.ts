import { rmSync } from 'node:fs';
import { join } from 'node:path';

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

/**
 * Datencache von Next leeren, bevor der Web-Server startet. Die Fahrgast-App hält die Städteliste
 * fünf Minuten (apps/web/src/app/[locale]/page.tsx), und der Cache liegt auf der Platte unter
 * `.next/cache/fetch-cache`, überlebt also Neustarts. Nach einem frischen Aufsetzen der
 * Testdatenbank hätte die Suche sonst bis zu fünf Minuten Städte-IDs, die es nicht mehr gibt.
 * Nur im Hauptprozess: Die Worker laden diese Datei erneut, während der Server schon läuft.
 */
if (process.env.TEST_WORKER_INDEX === undefined) {
  rmSync(join(WEB_DIR, '.next', 'cache', 'fetch-cache'), { recursive: true, force: true });
}

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
        // Testschlüssel für QR-Codes und Lesetokens (ADR 0022), in Produktion Pflicht; kein Geheimnis.
        TICKET_QR_KEY: 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=', // gitleaks:allow
        BOOKING_ACCESS_KEY: 'AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM=', // gitleaks:allow
      },
    },
    // Bereitschaft über eine Seite ohne Städteliste: `/ar` legt die Städte fünf Minuten in den
    // Datencache, und Playwright prüft die Bereitschaft vor dem Seed der Specs. Mit `/ar` sähen die
    // Web-Tests sonst die Städte, die vor dem Seed in der Datenbank standen.
    {
      command: 'pnpm start',
      cwd: WEB_DIR,
      url: `${WEB_URL}/ar/my-booking`,
      reuseExistingServer: false,
    },
    {
      command: 'pnpm start',
      cwd: PORTAL_DIR,
      url: `${PORTAL_URL}/ar/auth/login`,
      reuseExistingServer: false,
    },
  ],
});
