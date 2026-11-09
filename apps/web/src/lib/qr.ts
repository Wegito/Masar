import { encode } from 'uqr';

/** QR-Code als SVG-Geometrie: Kantenlänge in Modulen und ein Pfad mit allen dunklen Modulen. */
export interface QrGeometry {
  size: number;
  path: string;
}

/** Ruhezone um den Code in Modulen; die Norm verlangt vier. */
const QUIET_ZONE = 4;

/**
 * Erzeugt die Geometrie eines QR-Codes auf dem Web-Server (Schritt 1.4, ADR 0022). Der Browser
 * zeichnet daraus ein `<svg>` mit einem `<path>`: kein Client-JavaScript für die Kodierung, keine
 * Inline-Styles (CSP), kein Drittanbieter-Dienst. Fehlerkorrektur M (15 %) verträgt Knicke und
 * Kratzer auf Ausdrucken und Displays mit Sprüngen; das Token (43 Zeichen) ergibt Version 4 (33 × 33 Module).
 *
 * Jede Zeile wird zu Rechtecken aus zusammenhängenden dunklen Modulen zusammengefasst; das hält
 * den Pfad kurz (für den Cache auf dem Gerät).
 */
export function qrGeometry(content: string): QrGeometry {
  const { data } = encode(content, { ecc: 'M', border: QUIET_ZONE });
  const size = data.length;
  const parts: string[] = [];
  data.forEach((row, y) => {
    let x = 0;
    while (x < size) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < size && row[x]) {
        x += 1;
      }
      parts.push(`M${String(start)} ${String(y)}h${String(x - start)}v1h-${String(x - start)}z`);
    }
  });
  return { size, path: parts.join('') };
}
