import { describe, expect, it } from 'vitest';

import {
  addMoney,
  formatMoney,
  fromMajor,
  isCurrency,
  isWholeMajorUnit,
  money,
  multiplyMoney,
} from './money.js';

const ARABIC_INDIC_DIGIT = /[٠-٩۰-۹]/;

describe('Geld', () => {
  it('speichert SYP in Minor-Units nach ISO 4217 (zwei Stellen)', () => {
    expect(fromMajor(1500, 'SYP')).toEqual({ amountMinor: 150000, currency: 'SYP' });
  });

  it('rechnet Dezimalbeträge ohne Rundungsfehler um', () => {
    expect(fromMajor(19.99, 'USD').amountMinor).toBe(1999);
    expect(() => fromMajor(1.005, 'USD')).toThrow(RangeError);
  });

  it('lehnt nicht ganzzahlige oder unsichere Beträge ab', () => {
    expect(() => money(1.5, 'SYP')).toThrow(RangeError);
    expect(() => money(Number.MAX_SAFE_INTEGER + 1, 'SYP')).toThrow(RangeError);
  });

  it('erkennt ganze Haupteinheiten (Tarife in ganzen SYP)', () => {
    expect(isWholeMajorUnit(money(150000, 'SYP'))).toBe(true);
    expect(isWholeMajorUnit(money(150050, 'SYP'))).toBe(false);
  });

  it('addiert nur gleiche Währungen', () => {
    expect(addMoney(money(100, 'SYP'), money(250, 'SYP')).amountMinor).toBe(350);
    expect(() => addMoney(money(100, 'SYP'), money(100, 'USD'))).toThrow(TypeError);
  });

  it('multipliziert Tarif mal Fahrgäste ganzzahlig', () => {
    expect(multiplyMoney(money(150000, 'SYP'), 3).amountMinor).toBe(450000);
    expect(() => multiplyMoney(money(150000, 'SYP'), 1.5)).toThrow(RangeError);
  });

  it('erkennt unterstützte Währungen', () => {
    expect(isCurrency('SYP')).toBe(true);
    expect(isCurrency('XYZ')).toBe(false);
    expect(isCurrency('toString')).toBe(false);
  });

  it('formatiert SYP ohne Nachkommastellen', () => {
    // Intl trennt Symbol und Betrag mit geschütztem Leerzeichen (U+00A0), damit nichts umbricht.
    expect(formatMoney(money(150000, 'SYP'), 'en')).toBe('SYP\u00A01,500');
  });

  it('formatiert auf Arabisch mit westlichen Ziffern und syrischem Symbol', () => {
    const text = formatMoney(money(150000, 'SYP'), 'ar');
    expect(text).toContain('1,500');
    expect(text).toContain('ل.س');
    expect(text).not.toMatch(ARABIC_INDIC_DIGIT);
  });

  it('formatiert andere Währungen mit Nachkommastellen', () => {
    expect(formatMoney(money(1999, 'USD'), 'en')).toContain('19.99');
  });
});
