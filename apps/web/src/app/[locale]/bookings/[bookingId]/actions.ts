'use server';

import { apiSend } from '../../../../lib/api';
import { qrGeometry } from '../../../../lib/qr';
import { isUuid } from '../../../../lib/search';
import { type TicketData, tokenFromFragment, toTicketData } from '../../../../lib/ticket';
import type { TicketPageResponse } from '../../../../lib/types';

export type TicketLoadResult =
  { status: 'ok'; ticket: TicketData; loadedAt: string } | { status: 'error'; code: string };

/**
 * Lädt die Ticketseite (Schritt 1.4, ADR 0022). Das Token kommt aus dem Fragment der Seiten-URL
 * und erreicht den Web-Server nur im POST-Body dieser Server Action; zur API geht es im Header
 * `X-Manage-Token`. Es wird weder gespeichert noch geloggt. Die QR-Codes entstehen hier als
 * SVG-Geometrie; das QR-Token selbst geht nicht an den Browser zurück.
 */
export async function loadTicket(bookingId: unknown, token: unknown): Promise<TicketLoadResult> {
  if (
    !isUuid(bookingId) ||
    typeof token !== 'string' ||
    tokenFromFragment(`token=${token}`) === null
  ) {
    return { status: 'error', code: 'BOOKING_NOT_FOUND' };
  }
  const result = await apiSend<TicketPageResponse>(`/bookings/${bookingId}/ticket`, {
    method: 'GET',
    headers: { 'X-Manage-Token': token },
  });
  if (!result.ok) {
    return { status: 'error', code: result.problem.code };
  }
  return {
    status: 'ok',
    ticket: toTicketData(result.data, qrGeometry),
    loadedAt: new Date().toISOString(),
  };
}
