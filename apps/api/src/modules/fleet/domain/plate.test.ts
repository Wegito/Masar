import { describe, expect, it } from 'vitest';

import { normalizePlate } from './plate.js';

describe('normalizePlate', () => {
  it('fasst Leerraum zusammen und schreibt groß', () => {
    expect(normalizePlate('  dm   12-345 ')).toBe('DM 12-345');
  });

  it('wandelt arabisch-indische Ziffern und entfernt Richtungszeichen', () => {
    expect(normalizePlate('‏دمشق ١٢٣٤٥')).toBe('دمشق 12345');
    expect(normalizePlate('دمشق ١٢٣٤٥')).toBe(normalizePlate('دمشق  12345'));
  });

  it('lehnt leere, zu lange und unerlaubte Eingaben ab', () => {
    expect(normalizePlate('   ')).toBeNull();
    expect(normalizePlate('A'.repeat(21))).toBeNull();
    expect(normalizePlate('AB/12')).toBeNull();
    expect(normalizePlate('-AB12')).toBeNull();
    expect(normalizePlate('<script>')).toBeNull();
  });

  it('nimmt genau die Höchstlänge an', () => {
    expect(normalizePlate('A'.repeat(20))).toBe('A'.repeat(20));
  });
});
