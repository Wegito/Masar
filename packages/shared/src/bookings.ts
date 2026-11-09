/**
 * Buchungen im Portal (Schritt 2.5, ADR 0028). API und Portal nutzen dieselben Werte.
 */

/**
 * Zahlungsstand einer Buchung, abgeleitet aus Buchung und (ab Phase 3) `payment`-Zeilen:
 * - `UNPAID`: Hold, noch kein Zahlweg gewählt oder keine Zahlung eingegangen.
 * - `CASH_DUE`: Barreservierung, fällig bis zur Frist.
 * - `IN_REVIEW`: Zahlung wartet auf Prüfung (Wallet-Überweisung, Phase 3).
 * - `PAID`: bezahlt (Barzahlung bestätigt oder Zahlung erfolgreich).
 * - `NONE`: storniert oder abgelaufen, ohne dass gezahlt wurde.
 */
export const PAYMENT_STATES = ['UNPAID', 'CASH_DUE', 'IN_REVIEW', 'PAID', 'NONE'] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

export const BOOKING_LIST_LIMITS = {
  defaultLimit: 50,
  maxLimit: 200,
  /** Freitext: Anfang des Buchungscodes ab so vielen Zeichen. */
  minCodePrefix: 4,
  /** Freitext: Ende der Telefonnummer ab so vielen Ziffern. */
  minPhoneDigits: 3,
  /** Höchstens so viele Ziffern vom Ende der Telefonnummer (nationale Nummer in Syrien). */
  maxPhoneDigits: 9,
  /** Länge der Eingabe vor der Bereinigung. */
  maxQueryLength: 32,
} as const;
