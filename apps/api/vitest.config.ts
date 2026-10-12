import { defineConfig } from 'vitest/config';

// Vite 8 übernimmt experimentalDecorators und emitDecoratorMetadata aus der tsconfig.json.
// Ohne die Metadaten fände NestJS die Abhängigkeiten im Konstruktor nicht.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['test/global-setup.ts'],
    // Testdateien teilen sich eine Datenbank und laufen deshalb nacheinander.
    fileParallelism: false,
    env: {
      // Tests prüfen Verhalten, nicht die Konsole. Log-Tests leiten die Ausgabe selbst um.
      LOG_LEVEL: 'silent',
      // Testdatenbank aus compose.yaml (nur Entwicklungspasswörter), Anwendungsrolle.
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgresql://masar_app:masar_app_dev@localhost:5432/masar_test',
    },
  },
});
