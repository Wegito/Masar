import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/min';

import { stripBidiControls, toLatinDigits } from './digits.js';

export type PhoneParseResult =
  | { ok: true; e164: string; country: CountryCode | undefined }
  | { ok: false; reason: 'EMPTY' | 'INVALID' };

/**
 * Normalisiert eine Telefonnummer auf E.164 (z. B. `+963933123456`).
 *
 * Buchung und spätere Buchungssuche müssen dieselbe Eingabe identisch normalisieren, sonst findet
 * ein Fahrgast die eigene Buchung nicht. Deshalb läuft jede Eingabe durch diese eine Funktion.
 *
 * - Nationale Schreibweise ohne Vorwahl gilt als syrisch (`0933 123 456`).
 * - Internationale Nummern (Angehörige im Ausland) mit `+` oder `00`.
 * - Arabische Ziffern und unsichtbare Richtungszeichen werden vorher bereinigt.
 *
 * Geprüft wird mit den kompakten Metadaten (`min`): Länge und Nummernbereich, nicht der
 * Anschlusstyp. Ob eine Nummer ein Mobilanschluss ist, kann die API später strenger prüfen.
 */
export function normalizePhone(
  input: string,
  defaultCountry: CountryCode = 'SY',
): PhoneParseResult {
  const cleaned = toLatinDigits(stripBidiControls(input)).trim();
  if (cleaned === '') {
    return { ok: false, reason: 'EMPTY' };
  }
  const parsed = parsePhoneNumberFromString(cleaned, { defaultCountry, extract: false });
  if (!parsed?.isValid()) {
    return { ok: false, reason: 'INVALID' };
  }
  return { ok: true, e164: parsed.number, country: parsed.country };
}
