import type { Gender } from '@masar/shared';
import { describe, expect, it } from 'vitest';

import {
  assignedCount,
  completeSeats,
  distinctGenders,
  emptyAssignment,
  isSelectableFor,
  keepValidAssignment,
  nextPassenger,
  passengerOfSeat,
  seatStateFor,
  selectableSeatCount,
  toggleSeatFor,
} from './seat-assignment';
import type { SeatView } from './types';

function seat(label: string, state: SeatView['state'] = 'FREE', notFor: Gender[] = []): SeatView {
  return { seatId: label, label, row: 0, column: 0, side: 'LEFT', state, notFor };
}

/**
 * Reihe 3: In 3A sitzt eine fremde Frau, 3B ist deshalb für Männer gesperrt. Reihe 4: In 4A sitzt
 * ein fremder Mann, 4B ist für Frauen gesperrt. 5A und 5B sind frei für alle.
 */
const SEATS: SeatView[] = [
  seat('3A', 'TAKEN'),
  seat('3B', 'FREE', ['MALE']),
  seat('4A', 'TAKEN'),
  seat('4B', 'FREE', ['FEMALE']),
  seat('5A'),
  seat('5B'),
  seat('6A', 'NOT_ONLINE'),
  seat('6B', 'BLOCKED'),
];
const byLabel = (label: string): SeatView => SEATS.find((entry) => entry.label === label)!;

describe('Status je Fahrgast', () => {
  it('sperrt einen Sitz nur für das betroffene Geschlecht', () => {
    expect(seatStateFor(byLabel('3B'), 'MALE')).toBe('NOT_FOR_YOU');
    expect(seatStateFor(byLabel('3B'), 'FEMALE')).toBe('FREE');
    expect(seatStateFor(byLabel('4B'), 'FEMALE')).toBe('NOT_FOR_YOU');
    expect(seatStateFor(byLabel('4B'), 'MALE')).toBe('FREE');
  });

  it('übernimmt belegte, gesperrte und Schalter-Sitze unverändert', () => {
    expect(seatStateFor(byLabel('3A'), 'FEMALE')).toBe('TAKEN');
    expect(seatStateFor(byLabel('6A'), 'MALE')).toBe('NOT_ONLINE');
    expect(seatStateFor(byLabel('6B'), null)).toBe('BLOCKED');
  });

  it('wendet ohne Geschlecht (Fahrt ohne Regel) keine Sperre an', () => {
    expect(seatStateFor(byLabel('3B'), null)).toBe('FREE');
    expect(isSelectableFor(byLabel('4B'), null)).toBe(true);
  });
});

describe('Zuordnung', () => {
  it('weist jedem Fahrgast nur Sitze zu, die für sein Geschlecht frei sind', () => {
    const genders: Gender[] = ['FEMALE', 'MALE'];
    let assignment = emptyAssignment(2);
    // Der Mann (Fahrgast 2) kann 3B neben der fremden Frau nicht wählen.
    assignment = toggleSeatFor(assignment, 1, byLabel('3B'), genders[1]!);
    expect(assignment).toEqual([null, null]);
    // Die Frau (Fahrgast 1) schon.
    assignment = toggleSeatFor(assignment, 0, byLabel('3B'), genders[0]!);
    expect(assignment).toEqual(['3B', null]);
    // Belegte Sitze bekommt niemand.
    expect(toggleSeatFor(assignment, 1, byLabel('3A'), 'MALE')).toEqual(['3B', null]);
  });

  it('lässt ein Paar derselben Buchung nebeneinander sitzen', () => {
    let assignment = emptyAssignment(2);
    assignment = toggleSeatFor(assignment, 0, byLabel('5A'), 'FEMALE');
    assignment = toggleSeatFor(assignment, 1, byLabel('5B'), 'MALE');
    expect(assignment).toEqual(['5A', '5B']);
    expect(completeSeats(assignment)).toEqual(['5A', '5B']);
  });

  it('nimmt einem Fahrgast nie den Sitz eines anderen', () => {
    const assignment = toggleSeatFor(['5A', null], 1, byLabel('5A'), 'FEMALE');
    expect(assignment).toEqual(['5A', null]);
    expect(passengerOfSeat(assignment, '5A')).toBe(0);
    expect(passengerOfSeat(assignment, '5B')).toBeNull();
  });

  it('tauscht den eigenen Sitz und gibt ihn beim zweiten Antippen ab', () => {
    let assignment = toggleSeatFor(['5A', null], 0, byLabel('5B'), 'FEMALE');
    expect(assignment).toEqual(['5B', null]);
    assignment = toggleSeatFor(assignment, 0, byLabel('5B'), 'FEMALE');
    expect(assignment).toEqual([null, null]);
  });

  it('ignoriert einen ungültigen Fahrgast-Index', () => {
    expect(toggleSeatFor([null], 3, byLabel('5A'), 'MALE')).toEqual([null]);
  });

  it('springt zum nächsten Fahrgast ohne Sitz, reihum', () => {
    expect(nextPassenger(['5A', null, null], 0)).toBe(1);
    expect(nextPassenger(['5A', '5B', null], 1)).toBe(2);
    expect(nextPassenger([null, '5B', '3B'], 2)).toBe(0);
    expect(nextPassenger(['5A', '5B'], 1)).toBe(1);
  });

  it('zählt zugeordnete Sitze und meldet erst vollständige Auswahl', () => {
    expect(assignedCount(['5A', null])).toBe(1);
    expect(completeSeats(['5A', null])).toBeNull();
  });
});

describe('Nach neuem Sitzplan oder geänderten Fahrgastdaten', () => {
  it('behält nur Sitze, die für das Geschlecht des Fahrgasts noch frei sind', () => {
    // Fahrgast 1 war ein Mann auf 5A, Fahrgast 2 eine Frau auf 3B; jetzt ist 5A belegt.
    const seats = SEATS.map((entry) => (entry.label === '5A' ? seat('5A', 'TAKEN') : entry));
    expect(keepValidAssignment(['5A', '3B'], seats, ['MALE', 'FEMALE'])).toEqual([null, '3B']);
  });

  it('nimmt einem Fahrgast den Sitz, wenn sein Geschlecht geändert wurde', () => {
    expect(keepValidAssignment(['3B', '5B'], SEATS, ['MALE', 'FEMALE'])).toEqual([null, '5B']);
  });

  it('verwirft unbekannte Sitze und passt die Länge an die Fahrgäste an', () => {
    expect(keepValidAssignment(['weg'], SEATS, ['FEMALE', 'MALE'])).toEqual([null, null]);
  });
});

describe('Hilfen für die Anfrage', () => {
  it('nennt jedes Geschlecht einmal, in fester Reihenfolge', () => {
    expect(distinctGenders(['MALE', 'FEMALE', 'MALE'])).toEqual(['FEMALE', 'MALE']);
    expect(distinctGenders(['MALE', 'MALE'])).toEqual(['MALE']);
    expect(distinctGenders([null, null])).toEqual([]);
  });

  it('zählt Sitze, die irgendein Fahrgast wählen kann', () => {
    expect(selectableSeatCount(SEATS, ['MALE'])).toBe(3);
    expect(selectableSeatCount(SEATS, ['FEMALE'])).toBe(3);
    expect(selectableSeatCount(SEATS, ['FEMALE', 'MALE'])).toBe(4);
    expect(selectableSeatCount(SEATS, [])).toBe(4);
  });
});
