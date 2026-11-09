import type { BookingStatus, TicketStatus, TripStatus } from '@masar/shared';

/**
 * Zustandsautomaten von Buchung, Ticket und Fahrt (docs/domaenenmodell.md, „Zustandsautomaten").
 * Reine Funktionen ohne Ein- und Ausgabe.
 *
 * Ein Übergang in denselben Zustand ist ein No-op und kein Fehler: Ein doppelter Klick, ein
 * wiederholter Aufruf nach einem Netzabbruch oder ein doppelter Webhook ändern nichts.
 */
export type TransitionResult = 'APPLY' | 'NOOP' | 'REJECT';

type Machine<S extends string> = Readonly<Record<S, readonly S[]>>;

export const BOOKING_TRANSITIONS: Machine<BookingStatus> = {
  HELD: ['RESERVED', 'PENDING_CONFIRMATION', 'CONFIRMED', 'EXPIRED', 'CANCELLED'],
  RESERVED: ['CONFIRMED', 'EXPIRED', 'CANCELLED'],
  PENDING_CONFIRMATION: ['CONFIRMED', 'CANCELLED', 'EXPIRED'],
  CONFIRMED: ['CANCELLED'],
  CANCELLED: [],
  EXPIRED: [],
};

/** `CHECKED_IN` ist einmalig; ein eingecheckter Fahrgast wird nicht mehr ungültig gemacht. */
export const TICKET_TRANSITIONS: Machine<TicketStatus> = {
  ISSUED: ['CHECKED_IN', 'VOID'],
  CHECKED_IN: [],
  VOID: [],
};

export const TRIP_TRANSITIONS: Machine<TripStatus> = {
  DRAFT: ['SCHEDULED'],
  SCHEDULED: ['DEPARTED', 'CANCELLED'],
  DEPARTED: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

function transition<S extends string>(machine: Machine<S>, from: S, to: S): TransitionResult {
  if (from === to) {
    return 'NOOP';
  }
  return machine[from].includes(to) ? 'APPLY' : 'REJECT';
}

export function bookingTransition(from: BookingStatus, to: BookingStatus): TransitionResult {
  return transition(BOOKING_TRANSITIONS, from, to);
}

export function ticketTransition(from: TicketStatus, to: TicketStatus): TransitionResult {
  return transition(TICKET_TRANSITIONS, from, to);
}

export function tripTransition(from: TripStatus, to: TripStatus): TransitionResult {
  return transition(TRIP_TRANSITIONS, from, to);
}

/**
 * Erlaubt der Automat den Schritt? Eine Wiederholung zählt als erlaubt (No-op); ob sich etwas
 * ändert, sagt {@link bookingTransition} und Verwandte.
 */
export function canTransition(kind: 'booking', from: BookingStatus, to: BookingStatus): boolean;
export function canTransition(kind: 'ticket', from: TicketStatus, to: TicketStatus): boolean;
export function canTransition(kind: 'trip', from: TripStatus, to: TripStatus): boolean;
export function canTransition(
  kind: 'booking' | 'ticket' | 'trip',
  from: string,
  to: string,
): boolean {
  const machine = {
    booking: BOOKING_TRANSITIONS,
    ticket: TICKET_TRANSITIONS,
    trip: TRIP_TRANSITIONS,
  }[kind] as Machine<string>;
  return transition(machine, from, to) !== 'REJECT';
}
