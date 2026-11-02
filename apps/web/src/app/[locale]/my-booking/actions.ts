'use server';

import { apiSend } from '../../../lib/api';
import type { LookupResponse } from '../../../lib/types';

export type LookupState =
  | { status: 'idle' }
  | { status: 'found'; bookingId: string; token: string }
  | { status: 'error'; code: string };

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Sucht eine Buchung über Code und Telefon (Schritt 1.4, ADR 0009, 0022). Beides kommt im
 * POST-Body und geht im Body an die API, nie in eine URL; nichts davon wird gespeichert oder
 * geloggt. Zurück kommt nur die Buchungs-ID mit dem kurzlebigen Lesetoken; die Seite öffnet damit
 * die Ticketseite, das Token im Fragment.
 */
export async function lookupBooking(_previous: LookupState, form: FormData): Promise<LookupState> {
  const bookingCode = field(form, 'bookingCode');
  const phone = field(form, 'phone');
  if (bookingCode === '' || phone === '' || bookingCode.length > 20 || phone.length > 40) {
    return { status: 'error', code: 'VALIDATION_FAILED' };
  }
  const result = await apiSend<LookupResponse>('/bookings/lookup', {
    method: 'POST',
    body: { bookingCode, phone },
  });
  return result.ok
    ? { status: 'found', bookingId: result.data.booking.id, token: result.data.accessToken }
    : { status: 'error', code: result.problem.code };
}
