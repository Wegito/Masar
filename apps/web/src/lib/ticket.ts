import type { Locale } from '@masar/shared';

import type { QrGeometry } from './qr';
import type { TicketPageResponse } from './types';

/**
 * Reine Helfer der Ticketseite (Schritt 1.4, ADR 0022). Das Token steht nur im Fragment der
 * Seiten-URL (`#token=`), nie in Pfad oder Query; Browser schicken das Fragment nicht an den Server.
 */

/** Verwaltungstoken (22 Zeichen) oder Lesetoken (32 Zeichen), base64url wie in der API. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

/** Liest `token` aus einem Fragment wie `#token=…` (auch mit weiteren Teilen nach `&`). */
export function tokenFromFragment(fragment: string): string | null {
  const params = new URLSearchParams(fragment.startsWith('#') ? fragment.slice(1) : fragment);
  const token = params.get('token');
  return token !== null && TOKEN_PATTERN.test(token) ? token : null;
}

/** Pfad der Ticketseite mit dem Token im Fragment. */
export function ticketHref(locale: Locale, bookingId: string, token: string): string {
  return `/${locale}/bookings/${bookingId}#token=${token}`;
}

/** Ticket wie im Browser gebraucht: statt des QR-Tokens nur die fertige QR-Geometrie. */
export type TicketData = Omit<TicketPageResponse, 'tickets'> & {
  tickets: (Omit<TicketPageResponse['tickets'][number], 'qrToken'> & { qr: QrGeometry | null })[];
};

export function toTicketData(
  response: TicketPageResponse,
  qr: (content: string) => QrGeometry,
): TicketData {
  return {
    ...response,
    tickets: response.tickets.map(({ qrToken, ...ticket }) => ({
      ...ticket,
      qr: qrToken === null ? null : qr(qrToken),
    })),
  };
}

/** Hinweis zum Stand der Buchung; die Texte stehen unter `ticket.notice.*`. */
export type StatusNotice =
  | { key: 'held'; until: string | null }
  | { key: 'reservedCash'; until: string | null }
  | { key: 'pending' }
  | { key: 'confirmed' }
  | { key: 'tripCancelled' }
  | { key: 'cancelled' }
  | { key: 'expired' };

export function statusNotice(
  ticket: Pick<TicketData, 'status' | 'holdExpiresAt' | 'deadlineAt' | 'trip'>,
): StatusNotice {
  if (ticket.trip.status === 'CANCELLED' && ticket.status !== 'EXPIRED') {
    return { key: 'tripCancelled' };
  }
  switch (ticket.status) {
    case 'HELD':
      return { key: 'held', until: ticket.holdExpiresAt };
    case 'RESERVED':
      return { key: 'reservedCash', until: ticket.deadlineAt };
    case 'PENDING_CONFIRMATION':
      return { key: 'pending' };
    case 'CONFIRMED':
      return { key: 'confirmed' };
    case 'CANCELLED':
      return { key: 'cancelled' };
    case 'EXPIRED':
      return { key: 'expired' };
  }
}

/** Gespeicherte Kopie für die Anzeige ohne Netz; enthält nie das Token. */
export interface TicketCopy {
  version: 1;
  savedAt: string;
  ticket: TicketData;
}

export function storageKey(bookingId: string): string {
  return `masar.ticket.${bookingId}`;
}

/** Liest eine gespeicherte Kopie; Fremdes, Kaputtes oder alte Formate ergeben `null`. */
export function parseCopy(raw: string | null, bookingId: string): TicketCopy | null {
  if (raw === null) {
    return null;
  }
  try {
    const value = JSON.parse(raw) as Partial<TicketCopy> | null;
    if (
      value?.version === 1 &&
      typeof value.savedAt === 'string' &&
      value.ticket?.id === bookingId &&
      Array.isArray(value.ticket.tickets)
    ) {
      return value as TicketCopy;
    }
  } catch {
    // Kaputter Eintrag: wie keiner.
  }
  return null;
}
