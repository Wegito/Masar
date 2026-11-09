import { describe, expect, it } from 'vitest';

import {
  type CounterSeat,
  genderWarning,
  keepSellable,
  MAX_COUNTER_SEATS,
  occupiedStopPairs,
  type PassengerDraft,
  quoteBody,
  saleBody,
  toggleSeat,
} from './counter';

function seat(label: string, index: number, extra: Partial<CounterSeat> = {}): CounterSeat {
  return {
    seatId: `id-${label}`,
    label,
    row: Math.floor(index / 4),
    column: index % 4,
    side: index % 4 < 2 ? 'LEFT' : 'RIGHT',
    quota: 'ONLINE',
    state: 'FREE',
    occupiedRanges: [],
    selectableFor: null,
    ...extra,
  };
}

const SEATS = [
  seat('1A', 0),
  seat('1B', 1, { selectableFor: { FEMALE: true, MALE: false } }),
  seat('1C', 2, { state: 'TAKEN' }),
  seat('1D', 3, { quota: 'COUNTER' }),
  seat('2A', 4, { state: 'BLOCKED', quota: 'BLOCKED' }),
];

const MAP = {
  trip: { id: 'trip-1' } as never,
  from: { tripStopId: 'stop-0' } as never,
  to: { tripStopId: 'stop-3' } as never,
  genderRuleEnabled: true,
  nationalIdRequired: false,
};

function draft(label: string, extra: Partial<PassengerDraft> = {}): PassengerDraft {
  return { seatId: `id-${label}`, label, fullName: '', gender: '', nationalId: '', ...extra };
}

describe('Sitzwahl am Schalter', () => {
  it('wählt freie Sitze an und ab, in der Reihenfolge des Sitzplans', () => {
    let selection = toggleSeat([], SEATS[3]!, SEATS);
    selection = toggleSeat(selection, SEATS[0]!, SEATS);
    expect(selection.map((entry) => entry.label)).toEqual(['1A', '1D']);
    expect(toggleSeat(selection, SEATS[0]!, SEATS).map((entry) => entry.label)).toEqual(['1D']);
  });

  it('nimmt belegte und gesperrte Sitze nicht an, Schalter-Sitze schon', () => {
    expect(toggleSeat([], SEATS[2]!, SEATS)).toEqual([]);
    expect(toggleSeat([], SEATS[4]!, SEATS)).toEqual([]);
    expect(toggleSeat([], SEATS[3]!, SEATS)).toHaveLength(1);
  });

  it('begrenzt auf die Höchstzahl je Buchung', () => {
    const many = Array.from({ length: MAX_COUNTER_SEATS }, (_, i) => draft(`X${String(i)}`));
    expect(toggleSeat(many, SEATS[0]!, SEATS)).toHaveLength(MAX_COUNTER_SEATS);
  });

  it('behält Eingaben, wirft nach neuem Sitzplan nicht mehr freie Sitze heraus', () => {
    const selection = [draft('1A', { fullName: 'Rania' }), draft('1C')];
    expect(keepSellable(selection, SEATS)).toEqual([draft('1A', { fullName: 'Rania' })]);
  });

  it('warnt nur, wenn die Regel den Sitz für dieses Geschlecht ausschließt', () => {
    expect(genderWarning(SEATS[1], 'MALE')).toBe(true);
    expect(genderWarning(SEATS[1], 'FEMALE')).toBe(false);
    expect(genderWarning(SEATS[1], '')).toBe(false);
    expect(genderWarning(SEATS[0], 'MALE')).toBe(false);
  });
});

describe('Verkauf am Schalter', () => {
  const contact = { name: '  Rania Haddad ', phone: '0933 123 456', email: '' };

  it('baut den Body mit E.164-Telefon und übernimmt den Kontaktnamen für leere Fahrgäste', () => {
    const result = saleBody({
      map: MAP,
      contact,
      passengers: [
        draft('1A', { gender: 'FEMALE' }),
        draft('1B', { fullName: 'Omar', gender: 'MALE' }),
      ],
      locale: 'ar',
    });
    expect(result).toEqual({
      ok: true,
      body: {
        tripId: 'trip-1',
        fromStopId: 'stop-0',
        toStopId: 'stop-3',
        locale: 'ar',
        contact: { name: 'Rania Haddad', phone: '+963933123456' },
        passengers: [
          { seatId: 'id-1A', fullName: 'Rania Haddad', gender: 'FEMALE' },
          { seatId: 'id-1B', fullName: 'Omar', gender: 'MALE' },
        ],
      },
    });
  });

  it('meldet fehlende Sitze, Namen, Telefon, Geschlecht und Ausweis', () => {
    const base = { map: MAP, contact, locale: 'en' as const };
    expect(saleBody({ ...base, passengers: [] })).toEqual({ ok: false, field: 'seats' });
    expect(
      saleBody({ ...base, contact: { ...contact, name: ' ' }, passengers: [draft('1A')] }),
    ).toEqual({ ok: false, field: 'contactName' });
    expect(
      saleBody({ ...base, contact: { ...contact, phone: '12' }, passengers: [draft('1A')] }),
    ).toEqual({ ok: false, field: 'phone' });
    expect(saleBody({ ...base, passengers: [draft('1A')] })).toEqual({
      ok: false,
      field: 'passengers',
    });
    expect(
      saleBody({
        ...base,
        map: { ...MAP, nationalIdRequired: true },
        passengers: [draft('1A', { gender: 'MALE' })],
      }),
    ).toEqual({ ok: false, field: 'passengers' });
  });

  it('sendet die Ausweisnummer nur, wenn die Firma sie verlangt', () => {
    const passengers = [draft('1A', { gender: 'MALE', nationalId: ' 0102 ' })];
    const without = saleBody({ map: MAP, contact, passengers, locale: 'en' });
    expect(JSON.stringify(without)).not.toContain('nationalId');
    const withId = saleBody({
      map: { ...MAP, nationalIdRequired: true },
      contact,
      passengers,
      locale: 'en',
    });
    expect(JSON.stringify(withId)).toContain('"nationalId":"0102"');
  });

  it('baut die Vorschau mit Geschlecht nur, wenn angegeben', () => {
    expect(quoteBody(MAP, [draft('1A'), draft('1B', { gender: 'MALE' })])).toEqual({
      tripId: 'trip-1',
      fromStopId: 'stop-0',
      toStopId: 'stop-3',
      seats: [{ seatId: 'id-1A' }, { seatId: 'id-1B', gender: 'MALE' }],
    });
  });

  it('ordnet belegten Teilstrecken die Halte zu', () => {
    const stops = [{ seq: 0 }, { seq: 1 }, { seq: 2 }];
    expect(
      occupiedStopPairs(
        [
          { fromSeq: 0, toSeq: 1 },
          { fromSeq: 1, toSeq: 9 },
        ],
        stops,
      ),
    ).toEqual([[{ seq: 0 }, { seq: 1 }]]);
  });
});
