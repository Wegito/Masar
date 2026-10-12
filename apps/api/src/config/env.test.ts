import { describe, expect, it } from 'vitest';

import { validateEnv } from './env.js';

const DATABASE_URL = 'postgresql://masar_app:geheimes-passwort@localhost:5432/masar';

describe('Umgebungsvariablen', () => {
  it('setzt sichere Standardwerte', () => {
    expect(validateEnv({ DATABASE_URL })).toEqual({
      NODE_ENV: 'development',
      PORT: 3001,
      LOG_LEVEL: 'info',
      LOG_FORMAT: 'json',
      TRUST_PROXY: 0,
      DATABASE_URL,
    });
  });

  it('wandelt Zahlen aus Zeichenketten um', () => {
    expect(validateEnv({ DATABASE_URL, PORT: '8080', TRUST_PROXY: '1' })).toMatchObject({
      PORT: 8080,
      TRUST_PROXY: 1,
    });
  });

  it('verlangt eine PostgreSQL-Verbindung', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
    expect(() => validateEnv({ DATABASE_URL: 'mysql://x@localhost/db' })).toThrow(/DATABASE_URL/);
  });

  it('nennt bei Fehlern den Namen, aber nie den Wert', () => {
    const rawValue = 'wert-darf-nicht-erscheinen';
    expect(() => validateEnv({ DATABASE_URL, PORT: rawValue, LOG_LEVEL: rawValue })).toThrow(
      /^Ungültige Umgebungsvariablen: PORT, LOG_LEVEL$/,
    );
    expect(() =>
      validateEnv({ DATABASE_URL: 'http://masar_app:geheimes-passwort@host/db' }),
    ).toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining('geheimes-passwort') as unknown,
      }),
    );
  });
});
