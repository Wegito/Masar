import {
  BOOKING_CODE_ALPHABET,
  BOOKING_CODE_LENGTH,
  BOOKING_LIST_LIMITS,
  stripBidiControls,
  toLatinDigits,
} from '@masar/shared';

/**
 * Buchungsliste im Portal (Schritt 2.5, ADR 0028): Cursor, Freitext und Zeitraum. Reine Funktionen
 * ohne Ein- und Ausgabe. Sortiert wird nach der Abfahrt der Fahrt am Starthalt, dann nach
 * Buchungs-ID; der Cursor ist der Schlüssel des letzten Eintrags, base64url-kodiert und für
 * Clients opak.
 */

export interface BookingListCursor {
  departureAt: Date;
  bookingId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_CURSOR_LENGTH = 200;

export function encodeBookingListCursor(cursor: BookingListCursor): string {
  const key = ['b', cursor.departureAt.toISOString(), cursor.bookingId];
  return Buffer.from(JSON.stringify(key), 'utf8').toString('base64url');
}

/**
 * `null`, wenn der Cursor nicht von {@link encodeBookingListCursor} stammen kann. Das Präfix `b`
 * unterscheidet ihn vom Cursor der Fahrtenliste, damit ein vertauschter Cursor auffällt.
 */
export function decodeBookingListCursor(value: string): BookingListCursor | null {
  if (value.length === 0 || value.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(value)) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 3 || parsed[0] !== 'b') {
    return null;
  }
  const [, departure, bookingId] = parsed as unknown[];
  if (typeof departure !== 'string' || typeof bookingId !== 'string' || !UUID.test(bookingId)) {
    return null;
  }
  const departureAt = new Date(departure);
  if (Number.isNaN(departureAt.getTime()) || departureAt.toISOString() !== departure) {
    return null;
  }
  return { departureAt, bookingId };
}

/**
 * Freitext der Liste, bewusst eng: nur der Anfang des Buchungscodes oder das Ende der
 * Telefonnummer, nie Namen oder Ausweisnummern (ADR 0028). Beide Felder `null` gibt es nicht; eine
 * Eingabe, die zu keinem passt, ist `null` (Fehler `BOOKING_SEARCH_INVALID`).
 */
export interface BookingSearch {
  /** Großgeschrieben, nach Crockford gelesen (I und L als 1, O als 0), 4 bis 8 Zeichen. */
  codePrefix: string | null;
  /** Nur Ziffern, 3 bis 9, vom Ende der Nummer. */
  phoneSuffix: string | null;
}

export function parseBookingSearch(input: string): BookingSearch | null {
  if (input.length > BOOKING_LIST_LIMITS.maxQueryLength) {
    return null;
  }
  // Wie normalizeBookingCode: Leerraum, Bindestriche und Richtungszeichen fallen weg.
  const cleaned = toLatinDigits(stripBidiControls(input))
    .toUpperCase()
    .replace(/[\s\-‐-―_().]/g, '');
  if (cleaned.length === 0) {
    return null;
  }

  let phoneSuffix: string | null = null;
  const phoneLike = /^\+?\d+$/.test(cleaned);
  if (phoneLike) {
    const digits = cleaned.replace('+', '');
    if (digits.length >= BOOKING_LIST_LIMITS.minPhoneDigits) {
      // Eine ganze Nummer (0933…, +963933…) sucht über ihre letzten neun Ziffern.
      phoneSuffix = digits.slice(-BOOKING_LIST_LIMITS.maxPhoneDigits);
    }
  }

  let codePrefix: string | null = null;
  if (!cleaned.startsWith('+')) {
    const code = cleaned.replace(/[IL]/g, '1').replace(/O/g, '0');
    if (
      code.length >= BOOKING_LIST_LIMITS.minCodePrefix &&
      code.length <= BOOKING_CODE_LENGTH &&
      [...code].every((char) => BOOKING_CODE_ALPHABET.includes(char))
    ) {
      codePrefix = code;
    }
  }

  return codePrefix === null && phoneSuffix === null ? null : { codePrefix, phoneSuffix };
}

/** Zeitraum der Abfahrten als Kalendertage in Damaskus; `null` heißt offen. */
export interface BookingListRange {
  from: string | null;
  to: string | null;
}

/**
 * Standard-Zeitraum: Ohne Fahrt, ohne Tag und ohne Suchtext zeigt die Liste die kommenden
 * Abfahrten ab heute (Damaskus). Mit Fahrt oder Suchtext ist der Zeitraum offen, damit auch eine
 * vergangene Buchung zu finden ist. Ausdrücklich gesetzte Tage gelten immer.
 */
export function bookingListRange(input: {
  from?: string | undefined;
  to?: string | undefined;
  tripId?: string | undefined;
  hasSearch: boolean;
  today: string;
}): BookingListRange {
  const explicit = input.from !== undefined || input.to !== undefined;
  if (explicit) {
    return { from: input.from ?? null, to: input.to ?? null };
  }
  if (input.tripId !== undefined || input.hasSearch) {
    return { from: null, to: null };
  }
  return { from: input.today, to: null };
}
