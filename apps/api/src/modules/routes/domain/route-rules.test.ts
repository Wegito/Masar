import { describe, expect, it } from 'vitest';

import { cancellationRulesIssue } from './cancellation-rules.js';
import { hasDuplicateStations, routeChangeBlocker, routeStatus } from './route-rules.js';

describe('routeChangeBlocker', () => {
  it('erlaubt alles an einer aktiven Strecke ohne Fahrten', () => {
    for (const change of ['structure', 'names', 'fares'] as const) {
      expect(routeChangeBlocker({ isActive: true, tripCount: 0 }, change)).toBeNull();
    }
  });

  it('friert Halte und Stornoregel ein, sobald eine Fahrt die Strecke nutzt', () => {
    const used = { isActive: true, tripCount: 1 };
    expect(routeChangeBlocker(used, 'structure')).toBe('ROUTE_IN_USE');
    expect(routeChangeBlocker(used, 'names')).toBeNull();
    expect(routeChangeBlocker(used, 'fares')).toBeNull();
  });

  it('lässt an einer archivierten Strecke nichts mehr zu', () => {
    for (const change of ['structure', 'names', 'fares'] as const) {
      expect(routeChangeBlocker({ isActive: false, tripCount: 0 }, change)).toBe('ROUTE_ARCHIVED');
    }
  });
});

describe('hasDuplicateStations und routeStatus', () => {
  it('erkennt doppelte Haltestellen', () => {
    expect(hasDuplicateStations(['a', 'b', 'c'])).toBe(false);
    expect(hasDuplicateStations(['a', 'b', 'a'])).toBe(true);
  });

  it('bildet is_active auf den Status der API ab', () => {
    expect(routeStatus(true)).toBe('ACTIVE');
    expect(routeStatus(false)).toBe('ARCHIVED');
  });
});

describe('cancellationRulesIssue', () => {
  it('nimmt die Demo-Regel und eine leere Regel an', () => {
    expect(
      cancellationRulesIssue([
        { minMinutesBeforeDeparture: 1440, feeBps: 0 },
        { minMinutesBeforeDeparture: 0, feeBps: 5000 },
        { minMinutesBeforeDeparture: 120, feeBps: 2500 },
      ]),
    ).toBeNull();
    expect(cancellationRulesIssue([])).toBeNull();
  });

  it('lehnt doppelte Schwellen ab', () => {
    expect(
      cancellationRulesIssue([
        { minMinutesBeforeDeparture: 60, feeBps: 0 },
        { minMinutesBeforeDeparture: 60, feeBps: 1000 },
      ]),
    ).toBe('CANCELLATION_RULES_INVALID');
  });

  it('lehnt Gebühren ab, die kurz vor Abfahrt sinken', () => {
    expect(
      cancellationRulesIssue([
        { minMinutesBeforeDeparture: 1440, feeBps: 2500 },
        { minMinutesBeforeDeparture: 0, feeBps: 1000 },
      ]),
    ).toBe('CANCELLATION_RULES_INVALID');
  });
});
