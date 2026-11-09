import { describe, expect, it } from 'vitest';

import { apiPath } from './api-path';
import {
  addDays,
  calendarDateInstant,
  dateOptions,
  parsePassengers,
  parseSearchQuery,
  parseSeatPageQuery,
  searchHref,
  seatPageHref,
} from './search';

const DAMASCUS = '019a0000-0000-7000-8000-000000000001';
const ALEPPO = '019a0000-0000-7000-8000-000000000004';

describe('Suchparameter', () => {
  it('liest eine vollständige Suche', () => {
    expect(
      parseSearchQuery({ from: DAMASCUS, to: ALEPPO, date: '2026-11-03', passengers: '2' }),
    ).toEqual({
      ok: true,
      query: { from: DAMASCUS, to: ALEPPO, date: '2026-11-03', passengers: 2 },
    });
  });

  it('nimmt ohne Angabe einen Fahrgast an und übernimmt den Cursor', () => {
    const result = parseSearchQuery({
      from: DAMASCUS,
      to: ALEPPO,
      date: '2026-11-03',
      cursor: 'abc',
    });
    expect(result).toEqual({
      ok: true,
      query: { from: DAMASCUS, to: ALEPPO, date: '2026-11-03', passengers: 1, cursor: 'abc' },
    });
  });

  it('meldet fehlende Felder als unvollständig, nicht als ungültig', () => {
    expect(parseSearchQuery({})).toEqual({ ok: false, reason: 'incomplete' });
    expect(parseSearchQuery({ from: DAMASCUS, to: '', date: '2026-11-03' })).toEqual({
      ok: false,
      reason: 'incomplete',
    });
  });

  it('lehnt gleiche Städte ab', () => {
    expect(
      parseSearchQuery({ from: DAMASCUS, to: DAMASCUS.toUpperCase(), date: '2026-11-03' }),
    ).toEqual({ ok: false, reason: 'sameCity' });
  });

  it.each([
    { from: 'damascus', to: ALEPPO, date: '2026-11-03' },
    { from: DAMASCUS, to: ALEPPO, date: '2026-02-30' },
    { from: DAMASCUS, to: ALEPPO, date: '03.11.2026' },
    { from: DAMASCUS, to: ALEPPO, date: '2026-11-03', passengers: '10' },
    { from: DAMASCUS, to: ALEPPO, date: '2026-11-03', passengers: '0' },
    { from: DAMASCUS, to: ALEPPO, date: '2026-11-03', cursor: 'x'.repeat(513) },
  ])('lehnt ungültige Werte ab: %o', (params) => {
    expect(parseSearchQuery(params)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('nimmt bei mehrfach gesetzten Parametern den ersten Wert', () => {
    const result = parseSearchQuery({ from: [DAMASCUS, ALEPPO], to: ALEPPO, date: '2026-11-03' });
    expect(result.ok && result.query.from).toBe(DAMASCUS);
  });

  it('prüft die Anzahl Fahrgäste von 1 bis 9', () => {
    expect(parsePassengers(undefined)).toBe(1);
    expect(parsePassengers('9')).toBe(9);
    expect(parsePassengers('1.5')).toBeNull();
    expect(parsePassengers('٣')).toBeNull();
  });

  it('liest die Parameter der Sitzplan-Seite', () => {
    expect(parseSeatPageQuery({ from: DAMASCUS, to: ALEPPO, passengers: '3' })).toEqual({
      fromStopId: DAMASCUS,
      toStopId: ALEPPO,
      passengers: 3,
    });
    expect(parseSeatPageQuery({ from: DAMASCUS, to: 'x' })).toBeNull();
  });
});

describe('Kalendertage', () => {
  it('rechnet über Monats- und Jahresgrenzen', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('bietet ab heute fortlaufende Tage an', () => {
    expect(dateOptions('2026-11-30', 3)).toEqual(['2026-11-30', '2026-12-01', '2026-12-02']);
  });

  it('legt den Zeitpunkt zum Formatieren auf Mittag UTC, in Damaskus derselbe Tag', () => {
    expect(calendarDateInstant('2026-11-03')).toBe('2026-11-03T12:00:00.000Z');
  });
});

describe('Pfade', () => {
  it('baut den Link der Ergebnisseite ohne Geschlecht', () => {
    expect(searchHref({ from: DAMASCUS, to: ALEPPO, date: '2026-11-03', passengers: 2 })).toBe(
      `/search?from=${DAMASCUS}&to=${ALEPPO}&date=2026-11-03&passengers=2`,
    );
  });

  it('hängt den Cursor URL-kodiert an', () => {
    expect(
      searchHref({
        from: DAMASCUS,
        to: ALEPPO,
        date: '2026-11-03',
        passengers: 1,
        cursor: 'a+b/=',
      }),
    ).toContain('cursor=a%2Bb%2F%3D');
  });

  it('baut den Link der Sitzplan-Seite', () => {
    expect(seatPageHref('t1', { fromStopId: 'a', toStopId: 'b', passengers: 1 })).toBe(
      '/trips/t1?from=a&to=b&passengers=1',
    );
  });

  it('lässt leere Werte im API-Aufruf weg', () => {
    expect(
      apiPath('/trips/x/seat-map', { fromStopId: 'a', toStopId: 'b', gender: undefined }),
    ).toBe('/api/v1/trips/x/seat-map?fromStopId=a&toStopId=b');
    expect(apiPath('/cities')).toBe('/api/v1/cities');
  });
});
