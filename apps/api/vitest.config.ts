import { defineConfig } from 'vitest/config';

// Vite 8 übernimmt experimentalDecorators und emitDecoratorMetadata aus der tsconfig.json.
// Ohne die Metadaten fände NestJS die Abhängigkeiten im Konstruktor nicht.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
    // Tests prüfen Verhalten, nicht die Konsole. Log-Tests leiten die Ausgabe selbst um.
    env: { LOG_LEVEL: 'silent' },
  },
});
