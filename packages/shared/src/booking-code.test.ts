import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  BOOKING_CODE_ALPHABET,
  BOOKING_CODE_LENGTH,
  encodeBookingCode,
  formatBookingCode,
  normalizeBookingCode,
} from './booking-code.js';

describe('Buchungscode', () => {
  it('nutzt 32 eindeutige Zeichen ohne I, L, O und U', () => {
    expect(BOOKING_CODE_ALPHABET).toHaveLength(32);
    expect(new Set(BOOKING_CODE_ALPHABET).size).toBe(32);
    expect(BOOKING_CODE_ALPHABET).not.toMatch(/[ILOU]/);
  });

  it('kodiert 40 Bit in 8 Zeichen (bekannte Testvektoren)', () => {
    expect(encodeBookingCode(new Uint8Array([0, 0, 0, 0, 0]))).toBe('00000000');
    expect(encodeBookingCode(new Uint8Array([255, 255, 255, 255, 255]))).toBe('ZZZZZZZZ');
    expect(encodeBookingCode(new Uint8Array([0x01, 0x23, 0x45, 0x67, 0x89]))).toBe('04HMASW9');
  });

  it('verlangt genau 5 Zufallsbytes', () => {
    expect(() => encodeBookingCode(new Uint8Array(4))).toThrow(RangeError);
    expect(() => encodeBookingCode(new Uint8Array(6))).toThrow(RangeError);
  });

  it('übersteht Anzeige und erneute Eingabe unverändert', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = encodeBookingCode(randomBytes(5));
      expect(code).toHaveLength(BOOKING_CODE_LENGTH);
      expect(normalizeBookingCode(formatBookingCode(code))).toBe(code);
      expect(normalizeBookingCode(formatBookingCode(code).toLowerCase())).toBe(code);
    }
  });

  it.each([
    ['abcd-efgh', 'ABCDEFGH'],
    ['ABCD EFGH', 'ABCDEFGH'],
    ['oiL1-0000', '01110000'],
    ['١٢٣٤-٥٦٧٨', '12345678'],
    ['‏ABCD–EFGH', 'ABCDEFGH'],
  ])('liest %j als %s', (input, expected) => {
    expect(normalizeBookingCode(input)).toBe(expected);
  });

  it.each([['ABCD-EFGU'], ['ABC'], ['ABCD-EFGH-J'], ['ABCD-EF#H'], ['']])(
    'lehnt %j ab',
    (input) => {
      expect(normalizeBookingCode(input)).toBeNull();
    },
  );

  it('zeigt den Code in zwei Vierergruppen', () => {
    expect(formatBookingCode('ABCDEFGH')).toBe('ABCD-EFGH');
  });
});
