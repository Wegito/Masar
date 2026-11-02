import type { Locale } from '@masar/shared';

import type { BookingStatus } from './types';

/**
 * Reine Helfer für Fahrgastdaten, Hold und Zahlweg (Schritt 1.5). Läuft im Browser und auf dem
 * Web-Server; deshalb ohne die Telefonhilfen aus `@masar/shared` (die prüft nur die Server Action,
 * siehe booking-request.ts), damit `libphonenumber-js` nicht im Client-Bundle landet.
 */

/** Feldnamen im Formular; sie entsprechen den Pfaden in `errors[].path` der API. */
export type PassengerField = 'fullName' | 'gender' | 'nationalId';

export function passengerField(index: number, field: PassengerField): string {
  return `passengers.${String(index)}.${field}`;
}

export const CONTACT_NAME_FIELD = 'contact.name';
export const PHONE_FIELD = 'contact.phone';
export const EMAIL_FIELD = 'contact.email';

/** Fehler eines Felds: fehlt oder hat die falsche Form. Texte unter `booking.fieldErrors.*`. */
export type FieldError = 'required' | 'invalid';

/**
 * Codes, nach denen der Fahrgast andere Sitze wählen muss. Der Sitzplan wird dann neu geladen,
 * damit inzwischen vergebene Sitze als belegt erscheinen.
 */
export const SEAT_PROBLEM_CODES = [
  'SEAT_TAKEN',
  'SEAT_BLOCKED',
  'SEAT_NOT_ONLINE',
  'SEAT_UNKNOWN',
  'GENDER_RULE_CONFLICT',
] as const;

export type SeatProblemCode = (typeof SEAT_PROBLEM_CODES)[number];

export function isSeatProblem(code: string): code is SeatProblemCode {
  return (SEAT_PROBLEM_CODES as readonly string[]).includes(code);
}

/**
 * Codes mit eigenem Text im Formular (`booking.problems.*`); alle anderen zeigt `ProblemNotice`.
 */
export const BOOKING_PROBLEM_CODES = [
  ...SEAT_PROBLEM_CODES,
  'GENDER_REQUIRED',
  'NATIONAL_ID_REQUIRED',
  'TOO_MANY_SEATS',
  'TOO_MANY_OPEN_HOLDS',
  'VALIDATION_FAILED',
] as const;

export type BookingProblemCode = (typeof BOOKING_PROBLEM_CODES)[number];

export function isBookingProblem(code: string): code is BookingProblemCode {
  return (BOOKING_PROBLEM_CODES as readonly string[]).includes(code);
}

/**
 * `Idempotency-Key` für `POST /bookings`: 16 Zufallsbytes als base64url (22 Zeichen). Die Bytes
 * kommen von außen, damit der Test sie festlegen kann; im Browser aus `crypto.getRandomValues`,
 * das anders als `crypto.randomUUID` auch ohne HTTPS verfügbar ist (Demo im lokalen Netz).
 */
export function idempotencyKeyFrom(bytes: Uint8Array): string {
  if (bytes.length < 16) {
    throw new Error('Zu wenige Zufallsbytes');
  }
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Pfad der Seite „Zahlweg wählen" mit dem Verwaltungstoken nur im Fragment (ADR 0020). */
export function payHref(locale: Locale, bookingId: string, token: string): string {
  return `/${locale}/bookings/${bookingId}/pay#token=${token}`;
}

/**
 * Restzeit des Holds in ganzen Sekunden (nie negativ). Gerechnet wird mit der Uhr des Web-Servers:
 * `serverNow` ist ihr Stand beim Laden, `loadedAt` die Uhr des Geräts im selben Moment. Eine falsch
 * gestellte Geräteuhr verschiebt so den Countdown nicht.
 */
export function remainingSeconds(
  expiresAt: string,
  serverNow: string,
  loadedAt: number,
  now: number,
): number {
  const serverNowMs = Date.parse(serverNow) + (now - loadedAt);
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - serverNowMs) / 1000));
}

/** Countdown `m:ss` mit westlichen Ziffern, unabhängig von der Sprache. */
export function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${String(minutes)}:${String(rest).padStart(2, '0')}`;
}

/**
 * Was die Seite „Zahlweg wählen" für einen Status zeigt: Zahlweg nur bei `HELD`; reservierte oder
 * bestätigte Buchungen führen direkt zur Ticketseite; beendete erklären sich selbst.
 */
export type CheckoutStep = 'pay' | 'ticket' | 'expired' | 'cancelled';

export function checkoutStep(status: BookingStatus): CheckoutStep {
  switch (status) {
    case 'HELD':
      return 'pay';
    case 'RESERVED':
    case 'PENDING_CONFIRMATION':
    case 'CONFIRMED':
      return 'ticket';
    case 'EXPIRED':
      return 'expired';
    case 'CANCELLED':
      return 'cancelled';
  }
}
