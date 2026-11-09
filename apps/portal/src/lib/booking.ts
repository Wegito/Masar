import {
  type BookingChannel,
  type BookingStatus,
  formatMoney,
  type Gender,
  isActiveBookingStatus,
  isCurrency,
  isValidCalendarDate,
  type Locale,
  money,
  type PaymentMethod,
  type PaymentState,
  type TicketStatus,
  type TripStatus,
} from '@masar/shared';

/**
 * Buchungen aus Sicht des Personals (Schritt 2.5, ADR 0028), wie die API sie liefert
 * (docs/api-konventionen.md, Abschnitt „Buchungen im Portal"). Die Telefonnummer kommt nur
 * maskiert; den Klartext holt `reveal-contact` auf Klick, mit Audit-Eintrag in der API. Eine
 * Ausweisnummer erscheint nie, nur ob sie vorhanden ist.
 */

export interface StaffStop {
  tripStopId: string;
  seq: number;
  nameAr: string;
  nameEn: string;
  arrivalAt: string | null;
  departureAt: string | null;
}

export interface BookingListItem {
  id: string;
  /** 8 Zeichen ohne Bindestrich. */
  bookingCode: string;
  status: BookingStatus;
  channel: BookingChannel;
  paymentMethod: PaymentMethod | null;
  paymentState: PaymentState;
  trip: {
    id: string;
    departureAt: string;
    status: TripStatus;
    route: { id: string; nameAr: string; nameEn: string };
  };
  from: StaffStop;
  to: StaffStop;
  contact: { name: string; phoneMasked: string };
  passengerCount: number;
  total: { amountMinor: number; currency: string };
  holdExpiresAt: string | null;
  deadlineAt: string | null;
  createdAt: string;
}

export interface BookingHistoryEntry {
  at: string;
  action: string;
  actorType: 'USER' | 'GUEST' | 'SYSTEM';
  actorUserId: string | null;
  fromStatus: BookingStatus | null;
  toStatus: BookingStatus | null;
  reason: string | null;
}

/** Detail (`GET …/bookings/:id`), auch die Antwort von `lookup`, `confirm-cash` und `cancel`. */
export interface StaffBooking extends Omit<BookingListItem, 'contact' | 'trip'> {
  trip: BookingListItem['trip'] & { arrivalAt: string; bus: { id: string; plate: string } | null };
  fare: { amountMinor: number; currency: string };
  contact: { name: string; phoneMasked: string; hasEmail: boolean; purged: boolean };
  passengers: {
    id: string;
    seatId: string;
    seatLabel: string;
    fullName: string;
    gender: Gender | null;
    nationalIdPresent: boolean;
    status: string;
    ticketStatus: TicketStatus | null;
  }[];
  tickets: { id: string; passengerId: string; seatLabel: string; status: TicketStatus }[];
  history: BookingHistoryEntry[];
  confirmedAt: string | null;
  cancelledAt: string | null;
  cancelledBy: 'PASSENGER' | 'COMPANY' | 'SYSTEM' | null;
  cancelReason: string | null;
}

export interface BookingContact {
  phone: string;
  email: string | null;
}

export interface TripPassenger {
  passengerId: string;
  bookingId: string;
  seatId: string;
  seatLabel: string;
  fullName: string;
  gender: Gender | null;
  nationalIdPresent: boolean;
  bookingStatus: BookingStatus;
  channel: BookingChannel;
  paymentState: PaymentState;
  ticketStatus: TicketStatus | null;
  from: StaffStop;
  to: StaffStop;
}

export interface TripPassengers {
  trip: {
    id: string;
    status: TripStatus;
    departureAt: string;
    arrivalAt: string;
    route: { id: string; nameAr: string; nameEn: string };
    bus: { id: string; plate: string } | null;
    stops: StaffStop[];
  };
  items: TripPassenger[];
  summary: {
    passengers: number;
    paid: number;
    open: number;
    perStop: { tripStopId: string; boarding: number; alighting: number }[];
  };
}

export interface BookingActions {
  /** „Bar bezahlt" geht nur aus `RESERVED` (wie `BookingsService.confirmCash`). */
  confirmCash: boolean;
  /**
   * Storno durch die Firma ist bei jeder aktiven Buchung denkbar; ob es noch geht (etwa nach dem
   * Einsteigen), entscheidet die API und meldet sonst `BOOKING_NOT_CANCELLABLE`.
   */
  cancel: boolean;
}

export function bookingActions(status: BookingStatus): BookingActions {
  return { confirmCash: status === 'RESERVED', cancel: isActiveBookingStatus(status) };
}

/** Betrag für die Anzeige; eine unbekannte Währung erscheint roh statt mit Fehler. */
export function formatTotal(
  total: { amountMinor: number; currency: string },
  locale: Locale,
): string {
  return isCurrency(total.currency)
    ? formatMoney(money(total.amountMinor, total.currency), locale)
    : `${String(total.amountMinor)} ${total.currency}`;
}

/** Filter der Buchungsliste, wie im Formular; leere Werte heißen „alle". */
export interface BookingFilters {
  tripId: string;
  /** Tag der Abfahrt in Damaskus (`YYYY-MM-DD`); leer: kommende Abfahrten ab heute. */
  day: string;
  status: '' | BookingStatus;
  paymentMethod: '' | PaymentMethod;
  channel: '' | BookingChannel;
  /** Anfang des Buchungscodes oder Ende der Telefonnummer; geht nie in die URL der Seite. */
  q: string;
}

export const EMPTY_FILTERS: BookingFilters = {
  tripId: '',
  day: '',
  status: '',
  paymentMethod: '',
  channel: '',
  q: '',
};

/**
 * Query für `GET …/bookings`. Ein ungültiger Tag ergibt `null`, damit das Formular den Fehler
 * zeigt statt einer Anfrage, die die API ohnehin ablehnt.
 */
export function bookingListQuery(
  filters: BookingFilters,
  options: { cursor?: string; limit?: number } = {},
): string | null {
  const query = new URLSearchParams();
  if (filters.tripId !== '') query.set('tripId', filters.tripId);
  const day = filters.day.trim();
  if (day !== '') {
    if (!isValidCalendarDate(day)) return null;
    query.set('from', day);
    query.set('to', day);
  }
  if (filters.status !== '') query.set('status', filters.status);
  if (filters.paymentMethod !== '') query.set('paymentMethod', filters.paymentMethod);
  if (filters.channel !== '') query.set('channel', filters.channel);
  const q = filters.q.trim();
  if (q !== '') query.set('q', q);
  if (options.limit !== undefined) query.set('limit', String(options.limit));
  if (options.cursor !== undefined) query.set('cursor', options.cursor);
  const text = query.toString();
  return text === '' ? '' : `?${text}`;
}

/** Farbe des Zahlungsstands; Text kommt aus den Übersetzungen. */
export const PAYMENT_STATE_BADGE: Record<PaymentState, string> = {
  UNPAID: 'bg-amber-100 text-amber-900',
  CASH_DUE: 'bg-amber-100 text-amber-900',
  IN_REVIEW: 'bg-sky-100 text-sky-900',
  PAID: 'bg-emerald-100 text-emerald-900',
  NONE: 'bg-slate-200 text-slate-700',
};

export const BOOKING_STATUS_BADGE: Record<BookingStatus, string> = {
  HELD: 'bg-amber-100 text-amber-900',
  RESERVED: 'bg-amber-100 text-amber-900',
  PENDING_CONFIRMATION: 'bg-sky-100 text-sky-900',
  CONFIRMED: 'bg-emerald-100 text-emerald-900',
  CANCELLED: 'bg-red-100 text-red-900',
  EXPIRED: 'bg-slate-200 text-slate-700',
};

/** Bekannte Aktionen des Verlaufs; unbekannte zeigt die Oberfläche als „sonstige Änderung". */
export const HISTORY_ACTIONS = [
  'BOOKING_HELD',
  'BOOKING_RESERVED_CASH',
  'BOOKING_CONFIRMED_CASH',
  'BOOKING_CANCELLED_BY_PASSENGER',
  'BOOKING_CANCELLED_BY_COMPANY',
  'BOOKING_EXPIRED',
  'BOOKING_CONTACT_REVEALED',
  'BOOKING_SOLD_AT_COUNTER',
] as const;

export function historyActionKey(action: string): (typeof HISTORY_ACTIONS)[number] | 'OTHER' {
  return (HISTORY_ACTIONS as readonly string[]).includes(action)
    ? (action as (typeof HISTORY_ACTIONS)[number])
    : 'OTHER';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** IDs aus der Adresse (`?tripId=`, `/bookings/:id`) nur in UUID-Form an die API weitergeben. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}
