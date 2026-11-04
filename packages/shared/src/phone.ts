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

/**
 * Maskierte Anzeige einer E.164-Nummer für das Portal (Schritt 2.5, ADR 0028): Ländervorwahl,
 * erste Ziffer und die letzten drei Ziffern der nationalen Nummer bleiben, der Rest wird `*`,
 * in Dreiergruppen. `+963933123456` ergibt `+963 9** *** 456`. Eine Nummer, die sich nicht lesen
 * lässt, erscheint ganz maskiert, nie im Klartext.
 */
export function maskPhone(e164: string): string {
  const parsed = parsePhoneNumberFromString(e164);
  const national = parsed?.nationalNumber ?? '';
  if (parsed === undefined || national.length < 5) {
    return '***';
  }
  const keepEnd = 3;
  const masked = national[0] + '*'.repeat(national.length - 1 - keepEnd) + national.slice(-keepEnd);
  const groups = masked.match(/.{1,3}/g) ?? [masked];
  return `+${parsed.countryCallingCode} ${groups.join(' ')}`;
}
