import { describe, expect, it } from 'vitest';

import { resolveSegment, segmentsOverlap } from './segment.js';

const STOPS = [
  { id: 'damascus', seq: 0 },
  { id: 'homs', seq: 1 },
  { id: 'hama', seq: 2 },
  { id: 'aleppo', seq: 3 },
];

describe('resolveSegment', () => {
  it('liefert Halte und Positionen für Einstieg vor Ausstieg', () => {
    const result = resolveSegment(STOPS, 'homs', 'aleppo');
    expect(result).toEqual({
      ok: true,
      from: { id: 'homs', seq: 1 },
      to: { id: 'aleppo', seq: 3 },
      range: { fromSeq: 1, toSeq: 3 },
    });
  });

  it('hängt nicht von der Reihenfolge der Eingabeliste ab', () => {
    const result = resolveSegment([...STOPS].reverse(), 'damascus', 'homs');
    expect(result).toMatchObject({ ok: true, range: { fromSeq: 0, toSeq: 1 } });
  });

  it('lehnt umgekehrte Richtung und gleichen Halt ab', () => {
    expect(resolveSegment(STOPS, 'aleppo', 'homs')).toEqual({ ok: false });
    expect(resolveSegment(STOPS, 'hama', 'hama')).toEqual({ ok: false });
  });

  it('lehnt Halte ab, die nicht zur Fahrt gehören', () => {
    expect(resolveSegment(STOPS, 'beirut', 'aleppo')).toEqual({ ok: false });
    expect(resolveSegment(STOPS, 'damascus', 'amman')).toEqual({ ok: false });
  });
});

describe('segmentsOverlap', () => {
  it.each([
    [{ fromSeq: 0, toSeq: 2 }, { fromSeq: 2, toSeq: 4 }, false],
    [{ fromSeq: 2, toSeq: 4 }, { fromSeq: 0, toSeq: 2 }, false],
    [{ fromSeq: 0, toSeq: 3 }, { fromSeq: 2, toSeq: 4 }, true],
    [{ fromSeq: 0, toSeq: 4 }, { fromSeq: 1, toSeq: 2 }, true],
    [{ fromSeq: 1, toSeq: 2 }, { fromSeq: 1, toSeq: 2 }, true],
    [{ fromSeq: 0, toSeq: 1 }, { fromSeq: 3, toSeq: 4 }, false],
  ])('%o und %o überlappen: %s', (a, b, expected) => {
    expect(segmentsOverlap(a, b)).toBe(expected);
  });
});
