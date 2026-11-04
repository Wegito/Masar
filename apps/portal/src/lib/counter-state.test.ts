import { describe, expect, it } from 'vitest';

import { type CounterFailures, createLatestGate, nextFailures } from './counter';

const SEAT_TAKEN = { code: 'SEAT_TAKEN', params: { seats: ['2A'] } };
const NOT_FOUND = { code: 'NOT_FOUND' };

describe('Schalter: Fehlerzustand', () => {
  it('behält den Verkaufsfehler, wenn der Sitzplan danach neu geladen wird', () => {
    let state: CounterFailures<{ code: string }> = {};
    state = nextFailures(state, { type: 'saleStarted' });
    state = nextFailures(state, { type: 'saleFailed', failure: SEAT_TAKEN });
    state = nextFailures(state, { type: 'loadOk' });
    expect(state.sale).toEqual(SEAT_TAKEN);
    expect(state.load).toBeUndefined();
  });

  it('behält den Verkaufsfehler auch, wenn das Neuladen selbst scheitert', () => {
    let state: CounterFailures<{ code: string }> = {};
    state = nextFailures(state, { type: 'saleFailed', failure: SEAT_TAKEN });
    state = nextFailures(state, { type: 'loadFailed', failure: NOT_FOUND });
    expect(state.sale).toEqual(SEAT_TAKEN);
    expect(state.load).toEqual(NOT_FOUND);
  });

  it('löscht den Verkaufsfehler beim nächsten Versuch, bei geänderter Auswahl und nach Erfolg', () => {
    const failed = nextFailures({}, { type: 'saleFailed', failure: SEAT_TAKEN });
    expect(nextFailures(failed, { type: 'saleStarted' }).sale).toBeUndefined();
    expect(nextFailures(failed, { type: 'selectionChanged' }).sale).toBeUndefined();
    expect(nextFailures(failed, { type: 'saleOk' }).sale).toBeUndefined();
  });

  it('löscht einen Ladefehler nach erfolgreichem Laden', () => {
    const failed = nextFailures({}, { type: 'loadFailed', failure: NOT_FOUND });
    expect(nextFailures(failed, { type: 'loadOk' }).load).toBeUndefined();
  });
});

describe('Schalter: nur die jüngste Sitzplan-Anfrage zählt', () => {
  it('verwirft die Antwort einer älteren Anfrage', () => {
    const gate = createLatestGate();
    const first = gate.begin();
    const second = gate.begin();
    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);
  });

  it('verwirft laufende Anfragen nach einem Wechsel der Fahrt', () => {
    const gate = createLatestGate();
    const pending = gate.begin();
    gate.invalidate();
    expect(gate.isCurrent(pending)).toBe(false);
  });
});
