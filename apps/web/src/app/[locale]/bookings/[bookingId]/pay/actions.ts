'use server';

import { apiSend } from '../../../../../lib/api';
import { isUuid } from '../../../../../lib/search';
import { tokenFromFragment } from '../../../../../lib/ticket';
import type { BookingResponse } from '../../../../../lib/types';

/** Was der Browser für „Zahlweg wählen" braucht; ohne Telefon, E-Mail, Geschlecht, Ausweis. */
export interface CheckoutData {
  id: string;
  status: BookingResponse['status'];
  holdExpiresAt: string | null;
  total: BookingResponse['total'];
  trip: BookingResponse['trip'];
  from: BookingResponse['from'];
  to: BookingResponse['to'];
  passengers: { id: string; seatLabel: string; fullName: string }[];
}

export type CheckoutLoadResult =
  { status: 'ok'; booking: CheckoutData; serverNow: string } | { status: 'error'; code: string };

function validToken(token: unknown): token is string {
  return typeof token === 'string' && tokenFromFragment(`token=${token}`) !== null;
}

/**
 * Lädt die gehaltene Buchung (`GET /bookings/:id`, Schritt 1.5). Das Verwaltungstoken kommt aus
 * dem Fragment der Seiten-URL im POST-Body dieser Server Action und geht im Header
 * `X-Manage-Token` an die API (ADR 0020); es wird weder gespeichert noch geloggt. `serverNow`
 * erlaubt einen Countdown, der nicht von der Geräteuhr abhängt.
 */
export async function loadCheckout(
  bookingId: unknown,
  token: unknown,
): Promise<CheckoutLoadResult> {
  if (!isUuid(bookingId) || !validToken(token)) {
    return { status: 'error', code: 'BOOKING_NOT_FOUND' };
  }
  const result = await apiSend<BookingResponse>(`/bookings/${bookingId}`, {
    method: 'GET',
    headers: { 'X-Manage-Token': token },
  });
  if (!result.ok) {
    return { status: 'error', code: result.problem.code };
  }
  const booking = result.data;
  return {
    status: 'ok',
    booking: {
      id: booking.id,
      status: booking.status,
      holdExpiresAt: booking.holdExpiresAt,
      total: booking.total,
      trip: booking.trip,
      from: booking.from,
      to: booking.to,
      passengers: booking.passengers
        .filter((passenger) => passenger.status === 'ACTIVE')
        .map(({ id, seatLabel, fullName }) => ({ id, seatLabel, fullName })),
    },
    serverNow: new Date().toISOString(),
  };
}

export type ReserveState =
  { status: 'idle' } | { status: 'reserved' } | { status: 'error'; code: string; at: number };

/**
 * Barzahlung wählen (`POST /bookings/:id/reserve-cash`): `HELD` → `RESERVED` bis zur Barfrist.
 * Buchungs-ID und Token kommen im POST-Body; das Token ergänzt die Seite aus dem Fragment.
 */
export async function reserveCash(_previous: ReserveState, form: FormData): Promise<ReserveState> {
  const bookingId = form.get('bookingId');
  const token = form.get('token');
  const at = Date.now();
  if (!isUuid(bookingId) || !validToken(token)) {
    return { status: 'error', code: 'BOOKING_NOT_FOUND', at };
  }
  const result = await apiSend<BookingResponse>(`/bookings/${bookingId}/reserve-cash`, {
    method: 'POST',
    headers: { 'X-Manage-Token': token },
  });
  return result.ok ? { status: 'reserved' } : { status: 'error', code: result.problem.code, at };
}
