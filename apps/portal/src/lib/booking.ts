import {
  type BookingStatus,
  formatMoney,
  isActiveBookingStatus,
  isCurrency,
  type Locale,
  money,
  type PaymentMethod,
} from '@masar/shared';

/**
 * Buchung aus Sicht des Personals, wie `BookingView` der API (`POST
 * /companies/:companyId/bookings/lookup`, `.../confirm-cash`, `.../cancel`). Nur die Felder, die
 * das Portal zeigt.
 */
export interface StaffBooking {
  id: string;
  /** 8 Zeichen ohne Bindestrich. */
  bookingCode: string;
  status: BookingStatus;
  paymentMethod: PaymentMethod | null;
  trip: { id: string; departureAt: string };
  from: { nameAr: string; nameEn: string; departureAt: string | null };
  to: { nameAr: string; nameEn: string; arrivalAt: string | null };
  deadlineAt: string | null;
  total: { amountMinor: number; currency: string };
  contact: { name: string; phone: string; email: string | null };
  passengers: { id: string; seatLabel: string; fullName: string; status: string }[];
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
export function formatTotal(total: StaffBooking['total'], locale: Locale): string {
  return isCurrency(total.currency)
    ? formatMoney(money(total.amountMinor, total.currency), locale)
    : `${String(total.amountMinor)} ${total.currency}`;
}
