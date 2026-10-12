import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { ERROR_CODES, ERROR_HTTP_STATUS, httpStatusOf, isErrorCode } from './errors.js';

/** Liest die Fehlercode-Tabellen aus der Doku, ohne den Abschnitt „Geplant". */
function documentedCodes(): Map<string, number> {
  const markdown = readFileSync(
    new URL('../../../docs/api-konventionen.md', import.meta.url),
    'utf8',
  );
  const section = markdown.split('## Fehlercodes')[1]?.split('### Geplant')[0] ?? '';
  const rows = section.matchAll(/^\|\s*`([A-Z_]+)`\s*\|\s*(\d{3})\s*\|/gm);
  return new Map([...rows].map((row) => [row[1] ?? '', Number(row[2])]));
}

describe('Fehlercodes', () => {
  it('stimmen mit der Tabelle in docs/api-konventionen.md überein (Codes und HTTP-Status)', () => {
    const documented = documentedCodes();
    expect(documented.size).toBeGreaterThan(0);
    expect([...documented.keys()].sort()).toEqual([...ERROR_CODES].sort());
    for (const [code, status] of documented) {
      expect(isErrorCode(code) && httpStatusOf(code), code).toBe(status);
    }
  });

  it('verwenden nur Status 4xx und 5xx', () => {
    for (const status of Object.values(ERROR_HTTP_STATUS)) {
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(600);
    }
  });

  it('erkennen nur echte Codes, keine geerbten Objekteigenschaften', () => {
    expect(isErrorCode('SEAT_TAKEN')).toBe(true);
    expect(isErrorCode('toString')).toBe(false);
    expect(isErrorCode('seat_taken')).toBe(false);
    expect(isErrorCode(409)).toBe(false);
  });
});
