/**
 * Wandelt arabisch-indische (٠–٩) und erweiterte arabisch-indische Ziffern (۰–۹) in 0–9 um.
 * Nutzer mit arabischer Tastatur geben Telefonnummern und Codes oft so ein.
 */
export function toLatinDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (digit) => {
    const codePoint = digit.charCodeAt(0);
    const zero = codePoint >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(codePoint - zero);
  });
}

/**
 * Entfernt unsichtbare Richtungszeichen (LRM, RLM, Einbettungen, Isolates), die beim Kopieren
 * aus arabischem Text mitkommen und Vergleiche sonst still scheitern lassen.
 */
export function stripBidiControls(input: string): string {
  return input.replace(/[؜‎‏‪-‮⁦-⁩]/g, '');
}
