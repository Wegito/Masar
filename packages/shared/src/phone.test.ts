import { describe, expect, it } from 'vitest';

import { normalizePhone } from './phone.js';

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
