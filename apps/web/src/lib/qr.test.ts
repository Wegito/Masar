import { encode } from 'uqr';
import { describe, expect, it } from 'vitest';

import { qrGeometry } from './qr';

const TOKEN = 'q3ZJ5yH0bX7mJt9cR1aWkLpE2sVnD8gU4fIoYhTzQ6w';

/** Zeichnet den Pfad zurück in eine Matrix, um ihn mit der Kodierung zu vergleichen. */
function rasterize(size: number, path: string): boolean[][] {
  const grid = Array.from({ length: size }, () => Array.from({ length: size }, () => false));
  for (const match of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g)) {
    const [x, y, width] = [Number(match[1]), Number(match[2]), Number(match[3])];
    for (let i = 0; i < width; i++) {
      grid[y]![x + i] = true;
    }
  }
  return grid;
}

describe('QR-Geometrie', () => {
  it('bildet genau die Module der Kodierung ab, mit vier Modulen Ruhezone', () => {
    const { size, path } = qrGeometry(TOKEN);
    const { data } = encode(TOKEN, { ecc: 'M', border: 4 });
    expect(size).toBe(data.length);
    expect(rasterize(size, path)).toEqual(data);
    // Version 4 (33 Module, 43 Bytes passen bei M knapp nicht in Version 3) plus 2 × 4 Ruhezone.
    expect(size).toBe(41);
    const grid = rasterize(size, path);
    for (const index of [0, 1, 2, 3, size - 4, size - 1]) {
      expect(grid[index]!.some(Boolean)).toBe(false);
      expect(grid.some((row) => row[index])).toBe(false);
    }
  });

  it('enthält nur Pfadbefehle, keinen Klartext des Tokens', () => {
    const { path } = qrGeometry(TOKEN);
    expect(path).toMatch(/^(M\d+ \d+h\d+v1h-\d+z)+$/);
    expect(path).not.toContain(TOKEN.slice(0, 8));
  });

  it('ist für dasselbe Token immer gleich', () => {
    expect(qrGeometry(TOKEN)).toEqual(qrGeometry(TOKEN));
    expect(qrGeometry(`${TOKEN.slice(1)}x`).path).not.toBe(qrGeometry(TOKEN).path);
  });
});
