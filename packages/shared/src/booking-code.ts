import { stripBidiControls, toLatinDigits } from './digits.js';

/**
 * Buchungscodes nach Crockford-Base32: 32 Zeichen ohne I, L, O, U, damit sie sich am Telefon und am
 * Schalter nicht verwechseln lassen. 8 Zeichen = 40 Bit Zufall (ADR 0013).
 */
export const BOOKING_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const BOOKING_CODE_LENGTH = 8;
const BOOKING_CODE_RANDOM_BYTES = 5;

/**
 * Kodiert genau 5 Zufallsbytes (40 Bit) als 8-stelligen Code, je 5 Bit ein Zeichen.
 * Ohne Modulo, daher ohne Verzerrung. Die Zufallsbytes erzeugt der Aufrufer kryptografisch sicher.
 */
export function encodeBookingCode(randomBytes: Uint8Array): string {
  if (randomBytes.length !== BOOKING_CODE_RANDOM_BYTES) {
    throw new RangeError(`Es werden genau ${BOOKING_CODE_RANDOM_BYTES} Bytes erwartet`);
  }
  let bits = 0n;
  for (const byte of randomBytes) {
    bits = (bits << 8n) | BigInt(byte);
  }
  let code = '';
  for (let i = BOOKING_CODE_LENGTH - 1; i >= 0; i -= 1) {
    const index = Number((bits >> BigInt(i * 5)) & 31n);
    code += BOOKING_CODE_ALPHABET.charAt(index);
  }
  return code;
}

/**
 * Bereinigt eine Eingabe zu einem kanonischen Code oder `null`.
 * Akzeptiert Kleinbuchstaben, Bindestriche, Leerzeichen und arabische Ziffern.
 * Verwechselbare Zeichen werden nach Crockford gelesen: I und L als 1, O als 0.
 */
export function normalizeBookingCode(input: string): string | null {
  const cleaned = toLatinDigits(stripBidiControls(input))
    .toUpperCase()
    .replace(/[\s\-‐-―_]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
  if (cleaned.length !== BOOKING_CODE_LENGTH) {
    return null;
  }
  for (const char of cleaned) {
    if (!BOOKING_CODE_ALPHABET.includes(char)) {
      return null;
    }
  }
  return cleaned;
}

/** Anzeige in zwei Vierergruppen: `ABCD-EFGH`. */
export function formatBookingCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}
