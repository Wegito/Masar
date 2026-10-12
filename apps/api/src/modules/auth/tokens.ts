import { createHash, randomBytes } from 'node:crypto';

/** 32 Zufallsbytes als base64url (43 Zeichen): Sitzungen, Einladungen, Passwort-Reset. */
export function createToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Gespeichert wird nur der SHA-256-Hash. Ein Datenbank-Abzug enthält damit keine gültigen Tokens.
 * Ein einfacher Hash genügt hier (anders als bei Passwörtern), weil das Token 256 Bit Zufall hat.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
