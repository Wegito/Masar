import { describe, expect, it } from 'vitest';

import {
  canManageRoutes,
  fareMatrixDraft,
  farePairs,
  formatFare,
  parseMajor,
  suggestFares,
} from './routes';

const ARABIC_INDIC_DIGIT = /[٠-٩۰-۹]/;

describe('suggestFares', () => {
  it('summiert die Abschnittspreise für jede Teilstrecke', () => {
    expect(suggestFares(['250', '150', '300'])).toEqual({
      '0-1': '250',
      '0-2': '400',
      '0-3': '700',
      '1-2': '150',
      '1-3': '450',
      '2-3': '300',
    });
  });

  it('lässt Teilstrecken über einem fehlenden oder ungültigen Abschnitt leer', () => {
    expect(suggestFares(['250', '', '300'])).toEqual({ '0-1': '250', '2-3': '300' });
    expect(suggestFares(['0', '12.5'])).toEqual({});
  });
});

describe('fareMatrixDraft', () => {
  it('rechnet ganze SYP in Minor-Units und meldet Lücken', () => {
    expect(fareMatrixDraft(3, { '0-1': '250', '0-2': '400', '1-2': '' }, 'SYP')).toEqual({
      items: [
        { fromSeq: 0, toSeq: 1, amountMinor: 25_000 },
        { fromSeq: 0, toSeq: 2, amountMinor: 40_000 },
      ],
      missing: [[1, 2]],
    });
  });

  it('zählt Beträge über der Obergrenze als fehlend', () => {
    expect(fareMatrixDraft(2, { '0-1': '99999999' }, 'SYP').missing).toEqual([[0, 1]]);
  });
});

describe('Hilfen', () => {
  it('liefert alle Paare in Fahrtrichtung', () => {
    expect(farePairs(3)).toEqual([
      [0, 1],
      [0, 2],
      [1, 2],
    ]);
  });

  it('nimmt nur ganze positive Beträge mit westlichen Ziffern an', () => {
    expect(parseMajor(' 250 ')).toBe(250);
    expect(parseMajor('0')).toBeNull();
    expect(parseMajor('-5')).toBeNull();
    expect(parseMajor('2.5')).toBeNull();
    expect(parseMajor('٢٥٠')).toBeNull();
  });

  it('formatiert Tarife mit westlichen Ziffern', () => {
    expect(formatFare(25_000, 'SYP', 'en').replace(/\s/g, ' ')).toBe('SYP 250');
    expect(formatFare(25_000, 'SYP', 'ar')).not.toMatch(ARABIC_INDIC_DIGIT);
  });

  it('erlaubt das Schreiben nur Admins', () => {
    expect(canManageRoutes('ADMIN')).toBe(true);
    expect(canManageRoutes('AGENT')).toBe(false);
    expect(canManageRoutes('DRIVER')).toBe(false);
  });
});
