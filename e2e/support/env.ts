import { fileURLToPath } from 'node:url';

/** Verzeichnisse der Apps; Server und Skripte laufen jeweils dort. */
export const API_DIR = fileURLToPath(new URL('../../apps/api/', import.meta.url));
export const WEB_DIR = fileURLToPath(new URL('../../apps/web/', import.meta.url));
export const PORTAL_DIR = fileURLToPath(new URL('../../apps/portal/', import.meta.url));

/** Dieselben Ports wie in der Entwicklung; Web und Portal leiten /api an die API weiter. */
export const API_URL = 'http://localhost:3001';
export const WEB_URL = 'http://localhost:3000';
export const PORTAL_URL = 'http://localhost:3002';

/** Testdatenbank wie bei den API-Tests; die Werte sind die Entwicklungswerte aus compose.yaml. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://masar_app:masar_app_dev@localhost:5432/masar_test';
export const TEST_MIGRATE_DATABASE_URL =
  process.env.TEST_MIGRATE_DATABASE_URL ??
  'postgresql://masar_migrate:masar_migrate_dev@localhost:5432/masar_test';
