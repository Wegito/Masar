import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env.js';

const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

export interface EncryptedNationalId {
  /** Nonce (12 Bytes) ‖ Chiffrat ‖ Tag (16 Bytes), Spalte `national_id_encrypted`. */
  ciphertext: Buffer;
  keyId: string;
}

/**
 * Liest `NATIONAL_ID_KEYS` (`keyId:base64,…`). Fehlermeldungen nennen nie einen Schlüssel.
 * Exportiert für Tests.
 */
export function parseNationalIdKeys(raw: string | undefined): Map<string, Buffer> {
  const keys = new Map<string, Buffer>();
  if (raw === undefined) {
    return keys;
  }
  for (const entry of raw.split(',')) {
    const separator = entry.indexOf(':');
    const keyId = entry.slice(0, separator).trim();
    const key = Buffer.from(entry.slice(separator + 1).trim(), 'base64');
    if (separator < 1 || !KEY_ID_PATTERN.test(keyId) || key.length !== KEY_BYTES) {
      throw new Error(
        'NATIONAL_ID_KEYS ist ungültig: erwartet keyId:base64 mit 32 Bytes je Eintrag',
      );
    }
    if (keys.has(keyId)) {
      throw new Error('NATIONAL_ID_KEYS enthält eine Schlüssel-ID doppelt');
    }
    keys.set(keyId, key);
  }
  return keys;
}

/**
 * Verschlüsselung der Ausweisnummer in der Anwendung (ADR 0016): AES-256-GCM, zufällige 96-Bit-
 * Nonce je Wert, die ID der Fahrgastzeile als Associated Data. Ein Chiffrat lässt sich so nicht
 * unbemerkt in eine andere Zeile kopieren. Der erste Schlüssel verschlüsselt, alle entschlüsseln.
 */
@Injectable()
export class NationalIdCipher {
  private readonly keys: Map<string, Buffer>;
  private readonly activeKeyId: string | undefined;

  constructor(config: ConfigService<Env, true>) {
    this.keys = parseNationalIdKeys(config.get('NATIONAL_ID_KEYS', { infer: true }));
    this.activeKeyId = this.keys.keys().next().value;
  }

  get available(): boolean {
    return this.activeKeyId !== undefined;
  }

  encrypt(plaintext: string, passengerId: string): EncryptedNationalId {
    const keyId = this.activeKeyId;
    if (keyId === undefined) {
      throw new Error('Kein Schlüssel für Ausweisnummern konfiguriert');
    }
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.keys.get(keyId)!, nonce);
    cipher.setAAD(Buffer.from(passengerId, 'utf8'));
    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return { ciphertext: Buffer.concat([nonce, body, cipher.getAuthTag()]), keyId };
  }

  /** Nur mit eigener Berechtigung und Audit-Eintrag aufrufen (ADR 0016); bisher nur in Tests. */
  decrypt(encrypted: EncryptedNationalId, passengerId: string): string {
    const key = this.keys.get(encrypted.keyId);
    if (key === undefined) {
      throw new Error('Unbekannte Schlüssel-ID für Ausweisnummer');
    }
    const data = encrypted.ciphertext;
    const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, NONCE_BYTES));
    decipher.setAAD(Buffer.from(passengerId, 'utf8'));
    decipher.setAuthTag(data.subarray(data.length - TAG_BYTES));
    return Buffer.concat([
      decipher.update(data.subarray(NONCE_BYTES, data.length - TAG_BYTES)),
      decipher.final(),
    ]).toString('utf8');
  }
}
