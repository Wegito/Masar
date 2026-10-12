import { describe, expect, it } from 'vitest';

import { createToken, hashToken } from './tokens.js';

describe('Tokens', () => {
  it('haben 256 Bit Zufall als base64url', () => {
    const token = createToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('wiederholen sich nicht', () => {
    const tokens = new Set(Array.from({ length: 1_000 }, () => createToken()));
    expect(tokens.size).toBe(1_000);
  });

  it('werden als SHA-256-Hex gespeichert, deterministisch und ohne das Token selbst', () => {
    const token = createToken();
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toContain(token);
  });
});
