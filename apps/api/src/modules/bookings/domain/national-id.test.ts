import { describe, expect, it } from 'vitest';

import { nationalIdLast4, normalizeNationalId } from './national-id.js';

describe('Ausweisnummer', () => {
  it('normalisiert Leerzeichen, Bindestriche, Kleinbuchstaben und arabische Ziffern', () => {
    expect(normalizeNationalId(' 010-203 04050 ')).toBe('01020304050');
    expect(normalizeNationalId('٠١٠٢٠٣٠٤٠٥٠')).toBe('01020304050');
    expect(normalizeNationalId('n12345678')).toBe('N12345678');
  });

  it('lehnt zu kurze, zu lange und fremde Zeichen ab', () => {
    expect(normalizeNationalId('123')).toBeNull();
    expect(normalizeNationalId('1'.repeat(33))).toBeNull();
    expect(normalizeNationalId('1234<script>')).toBeNull();
  });

  it('zeigt nur die letzten vier Zeichen', () => {
    expect(nationalIdLast4('01020304050')).toBe('4050');
  });
});
