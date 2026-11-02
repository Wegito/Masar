import { randomBytes } from 'node:crypto';

import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import type { Env } from '../../config/env.js';
import { NationalIdCipher, parseNationalIdKeys } from './national-id.cipher.js';

function cipherWith(raw: string | undefined): NationalIdCipher {
  const config = { get: () => raw } as unknown as ConfigService<Env, true>;
  return new NationalIdCipher(config);
}

const keyA = randomBytes(32).toString('base64');
const keyB = randomBytes(32).toString('base64');
const passengerId = '0199f7a4-5c2e-7d3a-9b1e-2f4c6a8d0e12';

describe('Verschlüsselung der Ausweisnummer', () => {
  it('verschlüsselt mit dem ersten Schlüssel und entschlüsselt mit jedem bekannten', () => {
    const cipher = cipherWith(`neu:${keyA},alt:${keyB}`);
    const encrypted = cipher.encrypt('01020304050', passengerId);
    expect(encrypted.keyId).toBe('neu');
    expect(encrypted.ciphertext.toString('utf8')).not.toContain('01020304050');
    expect(encrypted.ciphertext).toHaveLength(12 + 11 + 16);
    expect(cipher.decrypt(encrypted, passengerId)).toBe('01020304050');

    // Rotation: Werte unter dem alten Schlüssel bleiben lesbar.
    const old = cipherWith(`alt:${keyB}`).encrypt('99887766', passengerId);
    expect(cipher.decrypt(old, passengerId)).toBe('99887766');
  });

  it('nutzt je Wert eine neue Nonce', () => {
    const cipher = cipherWith(`k:${keyA}`);
    expect(cipher.encrypt('12345678', passengerId).ciphertext).not.toEqual(
      cipher.encrypt('12345678', passengerId).ciphertext,
    );
  });

  it('scheitert, wenn das Chiffrat in eine andere Fahrgastzeile kopiert wird', () => {
    const cipher = cipherWith(`k:${keyA}`);
    const encrypted = cipher.encrypt('12345678', passengerId);
    expect(() => cipher.decrypt(encrypted, '0199f7a4-0000-7000-8000-000000000000')).toThrow();
  });

  it('meldet fehlende Schlüssel und lehnt kaputte Konfiguration ab, ohne Werte zu nennen', () => {
    expect(cipherWith(undefined).available).toBe(false);
    expect(() => cipherWith(undefined).encrypt('12345678', passengerId)).toThrow(/Kein Schlüssel/);
    expect(() => parseNationalIdKeys('k:kurz')).toThrow(/NATIONAL_ID_KEYS/);
    expect(() => parseNationalIdKeys(`${keyA}`)).toThrow(/NATIONAL_ID_KEYS/);
    expect(() => parseNationalIdKeys(`k:${keyA},k:${keyB}`)).toThrow(/doppelt/);
    try {
      parseNationalIdKeys(`k:${keyA.slice(0, 10)}`);
    } catch (error) {
      expect(String(error)).not.toContain(keyA.slice(0, 10));
    }
  });
});
