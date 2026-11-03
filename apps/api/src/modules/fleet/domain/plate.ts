import { BUS_PLATE_MAX_LENGTH, stripBidiControls, toLatinDigits } from '@masar/shared';

/**
 * Normalisiert ein Kennzeichen, damit „دمشق ١٢٣٤٥" und „دمشق  12345" derselbe Bus sind:
 * Unicode-NFC, Richtungszeichen entfernt, westliche Ziffern, Leerraum zusammengefasst,
 * Großbuchstaben. Liefert `null`, wenn das Ergebnis leer, zu lang oder mit unerlaubten Zeichen
 * ist. Erlaubt sind Buchstaben jeder Schrift, Ziffern, Leerzeichen und Bindestrich, am Anfang und
 * Ende nur Buchstaben oder Ziffern. Reine Funktion.
 */
export function normalizePlate(input: string): string | null {
  const value = toLatinDigits(stripBidiControls(input.normalize('NFC')))
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
  if (value.length === 0 || value.length > BUS_PLATE_MAX_LENGTH) {
    return null;
  }
  return /^[\p{L}\p{N}](?:[\p{L}\p{N} -]*[\p{L}\p{N}])?$/u.test(value) ? value : null;
}
