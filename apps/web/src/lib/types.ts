import type { Gender, SeatSide, SeatState } from '@masar/shared';

/**
 * Antwortformen der öffentlichen Endpunkte aus Schritt 1.2 (docs/api-konventionen.md, Abschnitt
 * „Suche und Sitzplan"). Nur die Felder, die die Oberfläche liest.
 */

export interface Named {
  nameAr: string;
  nameEn: string;
}

export interface City extends Named {
  id: string;
  slug: string;
}

export interface CitiesResponse {
  items: City[];
}

export interface MoneyView {
  amountMinor: number;
  currency: string;
}

export interface StopView extends Named {
  tripStopId: string;
  cityId: string;
  arrivalAt: string | null;
  departureAt: string | null;
}

export interface TripSearchItem {
  tripId: string;
  company: Named & { id: string };
  departureAt: string;
  arrivalAt: string | null;
  from: StopView;
  to: StopView;
  fare: MoneyView;
  freeSeats: { count: number; capped: boolean };
  genderRuleEnabled: boolean;
}

export interface TripSearchResponse {
  items: TripSearchItem[];
  nextCursor: string | null;
}

export interface SeatView {
  seatId: string;
  label: string;
  row: number;
  column: number;
  side: SeatSide;
  /** Status ohne Geschlechtsregel; die API liefert nie `NOT_FOR_YOU`. */
  state: Exclude<SeatState, 'NOT_FOR_YOU'>;
  /**
   * Angefragte Geschlechter, für die der freie Sitz gesperrt ist (ADR 0034). Die Oberfläche
   * rechnet daraus den Status je Fahrgast (`seatStateFor`) und zeigt die Sperre ohne Erklärung.
   */
  notFor: Gender[];
}

export interface SeatMapResponse {
  tripId: string;
  company: Named & { id: string };
  from: StopView;
  to: StopView;
  fare: MoneyView;
  genderRule: { enabled: boolean; appliedFor: Gender[] };
  /** Die Firma verlangt je Fahrgast eine Ausweisnummer (seit Schritt 1.5). */
  nationalIdRequired: boolean;
  layout: { rows: number; columns: number };
  seats: SeatView[];
}

/**
 * Buchung aus `POST /bookings` und `GET /bookings/:id` (docs/api-konventionen.md, Abschnitt
 * „Buchung"). Nur die Felder, die Hold und Zahlweg lesen; Kontakt, Geschlecht und Ausweisnummer
 * kommen zwar von der API, gehen aber nicht an den Browser weiter.
 */
export interface BookingResponse {
  id: string;
  status: BookingStatus;
  holdExpiresAt: string | null;
  deadlineAt: string | null;
  total: MoneyView;
  trip: { id: string; departureAt: string; company: Named & { id: string } };
  from: TicketStopView;
  to: TicketStopView;
  passengers: { id: string; seatLabel: string; fullName: string; status: string }[];
}

export interface CreateBookingResponse {
  booking: BookingResponse;
  manageToken: string;
}

/**
 * Ticketseite aus Schritt 1.4 (docs/api-konventionen.md, Abschnitt „Ticketseite"). Ohne
 * Kontaktdaten, Geschlecht und Ausweisnummer; der Name steht für das Personal beim Einsteigen.
 */
export type BookingStatus =
  'HELD' | 'RESERVED' | 'PENDING_CONFIRMATION' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED';

export type TicketStatus = 'ISSUED' | 'CHECKED_IN' | 'VOID';

export interface TicketStopView extends Named {
  tripStopId: string;
  arrivalAt: string | null;
  departureAt: string | null;
}

export interface TicketPageResponse {
  id: string;
  bookingCode: string;
  status: BookingStatus;
  paymentMethod: string | null;
  holdExpiresAt: string | null;
  deadlineAt: string | null;
  total: MoneyView;
  trip: { id: string; status: string; departureAt: string; company: Named & { id: string } };
  from: TicketStopView;
  to: TicketStopView;
  stops: TicketStopView[];
  passengers: { id: string; seatLabel: string; fullName: string; status: string }[];
  tickets: {
    id: string;
    passengerId: string;
    seatLabel: string;
    status: TicketStatus;
    qrToken: string | null;
  }[];
}

export interface LookupResponse {
  accessToken: string;
  accessExpiresAt: string;
  booking: TicketPageResponse;
}
