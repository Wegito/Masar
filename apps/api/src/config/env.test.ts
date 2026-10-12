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
      SESSION_COOKIE_SECURE: true,
      APP_ORIGINS: ['http://localhost:3000', 'http://localhost:3002'],
      PORTAL_URL: 'http://localhost:3002',
      SMTP_URL: 'smtp://localhost:1025',
      MAIL_FROM: 'Masar <no-reply@masar.invalid>',
    });
  });

  it('wandelt Zahlen aus Zeichenketten um', () => {
    expect(validateEnv({ DATABASE_URL, PORT: '8080', TRUST_PROXY: '1' })).toMatchObject({
      PORT: 8080,
      TRUST_PROXY: 1,
    });
  });

  it('liest Origins als Liste und lehnt Pfade ab', () => {
    expect(
      validateEnv({
        DATABASE_URL,
        APP_ORIGINS: 'https://masar.example, https://portal.masar.example',
      }).APP_ORIGINS,
    ).toEqual(['https://masar.example', 'https://portal.masar.example']);
    expect(() => validateEnv({ DATABASE_URL, APP_ORIGINS: 'https://masar.example/pfad' })).toThrow(
      /APP_ORIGINS/,
    );
  });

  it('liest Ja/Nein-Werte aus Zeichenketten', () => {
    expect(
      validateEnv({ DATABASE_URL, SESSION_COOKIE_SECURE: 'false' }).SESSION_COOKIE_SECURE,
    ).toBe(false);
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
