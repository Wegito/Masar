import { describe, expect, it } from 'vitest';

import { stripBidiControls, toLatinDigits } from './digits.js';

describe('Ziffern', () => {
  it('wandelt arabisch-indische Ziffern um', () => {
    expect(toLatinDigits('٠٩٣٣١٢٣٤٥٦')).toBe('0933123456');
  });

  it('wandelt erweiterte arabisch-indische Ziffern um', () => {
    expect(toLatinDigits('۰۹۳۳۱۲۳۴۵۶')).toBe('0933123456');
  });

  it('lässt andere Zeichen unverändert', () => {
    expect(toLatinDigits('+963 ٩٣٣-abc')).toBe('+963 933-abc');
  });

  it('entfernt unsichtbare Richtungszeichen', () => {
    expect(stripBidiControls('‏0933‎123⁦456⁩')).toBe('0933123456');
  });
});
