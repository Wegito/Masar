import { describe, expect, it } from 'vitest';

import { stripBidiControls } from './digits.js';
import {
  formatDate,
  formatDateTime,
  formatTime,
  isValidCalendarDate,
  localDateInDamascus,
} from './time.js';

const ARABIC_INDIC_DIGIT = /[٠-٩۰-۹]/;

// 20:30 UTC = 23:30 in Damaskus (UTC+3); 21:30 UTC = 00:30 am Folgetag.
const LATE_EVENING = '2026-10-20T20:30:00Z';
const AFTER_MIDNIGHT = '2026-10-20T21:30:00Z';

describe('Zeit in Damaskus', () => {
  it('ordnet 23:30 Ortszeit noch dem selben Tag zu', () => {
    expect(localDateInDamascus(LATE_EVENING)).toBe('2026-10-20');
    expect(formatTime(LATE_EVENING, 'en')).toBe('23:30');
  });

  it('ordnet 00:30 Ortszeit dem Folgetag zu, obwohl in UTC noch der Vortag ist', () => {
    expect(localDateInDamascus(AFTER_MIDNIGHT)).toBe('2026-10-21');
    expect(formatTime(AFTER_MIDNIGHT, 'en')).toBe('00:30');
  });

  it('nutzt die levantinischen Monatsnamen auf Arabisch', () => {
    expect(formatDate('2026-01-15T12:00:00Z', 'ar', 'long')).toContain('كانون الثاني');
  });

  it('nutzt auf Arabisch westliche Ziffern und 24 Stunden', () => {
    const text = stripBidiControls(formatDateTime(LATE_EVENING, 'ar'));
    expect(text).toContain('23:30');
    expect(text).toContain('2026');
    expect(text).not.toMatch(ARABIC_INDIC_DIGIT);
  });

  it('formatiert auf Englisch mit Tag vor Monat', () => {
    expect(formatDateTime(LATE_EVENING, 'en')).toBe('20 Oct 2026, 23:30');
  });

  it('lehnt ungültige Zeitpunkte ab', () => {
    expect(() => formatTime('kein Datum', 'en')).toThrow(RangeError);
  });

  it.each([
    ['2026-10-20', true],
    ['2028-02-29', true],
    ['2026-02-29', false],
    ['2026-13-01', false],
    ['2026-10-32', false],
    ['20261020', false],
    ['2026-1-5', false],
  ])('Kalendertag %s gültig: %s', (value, valid) => {
    expect(isValidCalendarDate(value)).toBe(valid);
  });
});
