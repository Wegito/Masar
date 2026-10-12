import { describe, expect, it } from 'vitest';

import { validateEnv } from './env.js';

describe('Umgebungsvariablen', () => {
  it('setzt sichere Standardwerte', () => {
    expect(validateEnv({})).toEqual({
      NODE_ENV: 'development',
      PORT: 3001,
      LOG_LEVEL: 'info',
      LOG_FORMAT: 'json',
      TRUST_PROXY: 0,
    });
  });

  it('wandelt Zahlen aus Zeichenketten um', () => {
    expect(validateEnv({ PORT: '8080', TRUST_PROXY: '1' })).toMatchObject({
      PORT: 8080,
      TRUST_PROXY: 1,
    });
  });

  it('nennt bei Fehlern den Namen, aber nie den Wert', () => {
    const secretLike = 'geheim-1234-wert';
    expect(() => validateEnv({ PORT: secretLike, LOG_LEVEL: secretLike })).toThrow(
      /^Ungültige Umgebungsvariablen: PORT, LOG_LEVEL$/,
    );
    try {
      validateEnv({ PORT: secretLike });
    } catch (error) {
      expect(String(error)).not.toContain(secretLike);
    }
  });
});
