import { stripBidiControls, toLatinDigits } from '@masar/shared';

/**
 * Ausweisnummern (ADR 0016). Reine Funktionen; die Verschlüsselung macht `NationalIdCipher`.
 *
 * Normalisiert wird vor dem Verschlüsseln, damit Anzeige der letzten vier Stellen und spätere
 * Vergleiche am Kontrollpunkt nicht an Leerzeichen oder arabischen Ziffern scheitern.
 */
const NATIONAL_ID_PATTERN = /^[0-9A-Z]{4,32}$/;

/** Großbuchstaben, westliche Ziffern, ohne Leerzeichen und Bindestriche; `null`, wenn ungültig. */
export function normalizeNationalId(input: string): string | null {
  const cleaned = toLatinDigits(stripBidiControls(input))
    .toUpperCase()
    .replace(/[\s\-‐-―_./]/g, '');
  return NATIONAL_ID_PATTERN.test(cleaned) ? cleaned : null;
}

/** Nur diese vier Zeichen stehen im Klartext in der Datenbank, zur Anzeige für Personal. */
export function nationalIdLast4(normalized: string): string {
  return normalized.slice(-4);
}
