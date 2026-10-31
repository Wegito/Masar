/**
 * Grenzen einer Buchung, geteilt von API und Oberfläche. Annahmen bis zur ersten Partnerfirma
 * (docs/offene-entscheidungen.md).
 */
export const BOOKING_LIMITS = {
  /** Sitze je Buchung; mehr ergibt TOO_MANY_SEATS. */
  maxSeatsPerBooking: 6,
} as const;
