import type { SeatSide, SeatState } from '@masar/shared';

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
  state: SeatState;
}

export interface SeatMapResponse {
  tripId: string;
  company: Named & { id: string };
  from: StopView;
  to: StopView;
  fare: MoneyView;
  genderRule: { enabled: boolean; applied: boolean };
  layout: { rows: number; columns: number };
  seats: SeatView[];
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
