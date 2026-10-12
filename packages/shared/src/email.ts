/**
 * Normalisiert eine E-Mail-Adresse für Vergleich und Speicherung: Unicode-NFC, ohne Leerraum am
 * Rand, klein geschrieben. Die Datenbank prüft dieselbe Regel per CHECK-Constraint, damit A@x und
 * a@x nie als zwei Konten entstehen.
 */
export function normalizeEmail(input: string): string {
  return input.normalize('NFC').trim().toLowerCase();
}
