import { describe, expect, it } from 'vitest';

import { maskPhone, normalizePhone } from './phone.js';

const SYRIAN = '+963933123456';

describe('Telefon-Normalisierung', () => {
  // Buchung und Buchungssuche müssen für dieselbe Person denselben Schlüssel ergeben,
  // egal wie die Nummer eingetippt wurde.
  it.each([
    ['national mit Leerzeichen', '0933 123 456'],
    ['national ohne Leerzeichen', '0933123456'],
    ['international mit +', '+963 933 123 456'],
    ['international mit 00', '00963933123456'],
    ['mit Bindestrichen', '0933-123-456'],
    ['arabisch-indische Ziffern', '٠٩٣٣١٢٣٤٥٦'],
    ['mit unsichtbaren Richtungszeichen', '‏0933 123 456‏'],
  ])('%s ergibt dieselbe E.164-Nummer', (_label, input) => {
    expect(normalizePhone(input)).toEqual({ ok: true, e164: SYRIAN, country: 'SY' });
  });

  it('akzeptiert Nummern aus dem Ausland (Angehörige)', () => {
    expect(normalizePhone('+49 151 23456789')).toEqual({
      ok: true,
      e164: '+4915123456789',
      country: 'DE',
    });
  });

  it.each([[''], ['   '], ['‏']])('meldet leere Eingabe %j', (input) => {
    expect(normalizePhone(input)).toEqual({ ok: false, reason: 'EMPTY' });
  });

  it.each([['0933 12'], ['abc'], ['0933123456 ruf an'], ['+963 1']])(
    'lehnt ungültige Eingabe %j ab',
    (input) => {
      expect(normalizePhone(input)).toEqual({ ok: false, reason: 'INVALID' });
    },
  );
});

describe('Maskierte Telefonnummer', () => {
  it('zeigt Vorwahl, erste und letzte drei Ziffern einer syrischen Nummer', () => {
    expect(maskPhone(SYRIAN)).toBe('+963 9** *** 456');
  });

  it('maskiert auch Nummern aus dem Ausland, ohne mittlere Ziffern zu verraten', () => {
    const masked = maskPhone('+4915123456789');
    expect(masked).toBe('+49 1** *** **7 89');
    expect(masked).not.toContain('2345');
  });

  it('gibt bei unlesbaren Werten nur Sterne aus', () => {
    expect(maskPhone('kaputt')).toBe('***');
    expect(maskPhone('+963')).toBe('***');
  });
});
