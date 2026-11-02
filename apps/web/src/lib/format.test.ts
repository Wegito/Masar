import { describe, expect, it } from 'vitest';

import { arrivalDayOffset, formatFare, freeSeatsLabel, localizedName } from './format';
import { problemMessageKey } from './problem';

const ARABIC_INDIC_DIGIT = /[٠-٩۰-۹]/;

/** Intl trennt Code und Betrag mit einem geschützten Leerzeichen. */
const plain = (text: string): string => text.replace(/\s/g, ' ');

describe('Anzeige', () => {
  it('formatiert den Tarif aus Minor-Units mit westlichen Ziffern', () => {
    const fare = { amountMinor: 60_000, currency: 'SYP' };
    expect(plain(formatFare(fare, 'en'))).toBe('SYP 600');
    expect(formatFare(fare, 'ar')).toContain('600');
    expect(formatFare(fare, 'ar')).not.toMatch(ARABIC_INDIC_DIGIT);
  });

  it('multipliziert mit der Anzahl Sitze ohne Fließkomma', () => {
    expect(plain(formatFare({ amountMinor: 35_000, currency: 'SYP' }, 'en', 3))).toBe('SYP 1,050');
  });

  it('zeigt unbekannte Währungen nüchtern statt abzustürzen', () => {
    expect(formatFare({ amountMinor: 500, currency: 'XYZ' }, 'en')).toBe('500 XYZ');
  });

  it('kappt freie Sitze als „9+"', () => {
    expect(freeSeatsLabel({ count: 9, capped: true })).toBe('9+');
    expect(freeSeatsLabel({ count: 3, capped: false })).toBe('3');
  });

  it('erkennt die Ankunft am Folgetag in Damaskus', () => {
    // 23:00 in Damaskus (20:00 UTC) bis 04:20 am Folgetag.
    expect(arrivalDayOffset('2026-11-03T20:00:00.000Z', '2026-11-04T01:20:00.000Z')).toBe(1);
    // 20:30 UTC ist 23:30 in Damaskus, noch derselbe Tag wie 07:00 Ortszeit.
    expect(arrivalDayOffset('2026-11-03T04:00:00.000Z', '2026-11-03T20:30:00.000Z')).toBe(0);
    expect(arrivalDayOffset('2026-11-03T04:00:00.000Z', null)).toBe(0);
  });

  it('wählt den Namen in der Sprache der Seite', () => {
    const city = { nameAr: 'حلب', nameEn: 'Aleppo' };
    expect(localizedName(city, 'ar')).toBe('حلب');
    expect(localizedName(city, 'en')).toBe('Aleppo');
  });

  it('übersetzt nur bekannte Fehlercodes, sonst allgemein', () => {
    expect(problemMessageKey('SALES_CLOSED')).toBe('SALES_CLOSED');
    expect(problemMessageKey('SEAT_TAKEN')).toBe('generic');
  });
});
