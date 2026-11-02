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
