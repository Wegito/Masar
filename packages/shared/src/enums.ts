/**
 * Fachliche Aufzählungen, geteilt von API und Oberflächen.
 * Die Werte entsprechen den Enums im Datenbankschema (ab Schritt 1.1, dort per Test abgeglichen).
 */

export const COMPANY_ROLES = ['ADMIN', 'AGENT', 'DRIVER'] as const;
export type CompanyRole = (typeof COMPANY_ROLES)[number];

/** Selbstauskunft, nur für die Sitzregel und die Fahrgastliste (siehe ADR 0006). */
export const GENDERS = ['FEMALE', 'MALE'] as const;
export type Gender = (typeof GENDERS)[number];

export const BOOKING_CHANNELS = ['ONLINE', 'COUNTER', 'ADMIN'] as const;
export type BookingChannel = (typeof BOOKING_CHANNELS)[number];

export const PAYMENT_METHODS = ['CASH', 'WALLET_TRANSFER', 'ECASH', 'INTL_CARD'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const BOOKING_STATUSES = [
  'HELD',
  'RESERVED',
  'PENDING_CONFIRMATION',
  'CONFIRMED',
  'CANCELLED',
  'EXPIRED',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** Status, in denen eine Buchung Sitze belegt (Zeilen in seat_occupation hat). */
export const ACTIVE_BOOKING_STATUSES = [
  'HELD',
  'RESERVED',
  'PENDING_CONFIRMATION',
  'CONFIRMED',
] as const satisfies readonly BookingStatus[];

/** Endzustände: keine Belegung, kein weiterer Übergang. */
export const TERMINAL_BOOKING_STATUSES = [
  'CANCELLED',
  'EXPIRED',
] as const satisfies readonly BookingStatus[];

export function isActiveBookingStatus(status: BookingStatus): boolean {
  return (ACTIVE_BOOKING_STATUSES as readonly BookingStatus[]).includes(status);
}

export const CANCEL_ACTORS = ['PASSENGER', 'COMPANY', 'SYSTEM'] as const;
export type CancelActor = (typeof CANCEL_ACTORS)[number];

export const PAYMENT_STATUSES = [
  'PENDING',
  'AWAITING_REVIEW',
  'SUCCEEDED',
  'FAILED',
  'REJECTED',
  'CANCELLED',
  'EXPIRED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Wer das Geld erhält. PLATFORM erst mit Zahlungen aus dem Ausland (ADR 0008). */
export const PAYEES = ['COMPANY', 'PLATFORM'] as const;
export type Payee = (typeof PAYEES)[number];

export const REFUND_STATUSES = [
  'REQUESTED',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED',
  'MANUAL_DONE',
] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const TICKET_STATUSES = ['ISSUED', 'CHECKED_IN', 'VOID'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TRIP_STATUSES = ['DRAFT', 'SCHEDULED', 'DEPARTED', 'COMPLETED', 'CANCELLED'] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];

/** Zustand eines Sitzes im Sitzplan für ein gewähltes Segment und Geschlecht. */
export const SEAT_STATES = ['FREE', 'TAKEN', 'NOT_ONLINE', 'BLOCKED', 'NOT_FOR_YOU'] as const;
export type SeatState = (typeof SEAT_STATES)[number];
