'use server';

import type { Gender } from '@masar/shared';

import { apiSend } from '../../../../lib/api';
import type { FieldError } from '../../../../lib/booking';
import {
  buildBookingRequest,
  buildSeatMapRequest,
  fieldsFromApiPaths,
  formValues,
} from '../../../../lib/booking-request';
import type { CreateBookingResponse, SeatMapResponse } from '../../../../lib/types';

export type SeatMapState =
  | { status: 'idle' }
  | {
      status: 'loaded';
      seatMap: SeatMapResponse;
      /** Geschlecht je Fahrgast in der Reihenfolge der Fahrgastdaten; `null` ohne Regel. */
      genders: (Gender | null)[];
      at: number;
    }
  | {
      status: 'invalid';
      /** `INVALID_FORM` bei kaputten versteckten Feldern, sonst `VALIDATION_FAILED`. */
      code: string;
      fields: Record<string, FieldError>;
      at: number;
    }
  | { status: 'error'; code: string; at: number };

/**
 * Prüft die Fahrgastdaten und lädt danach den Sitzplan für genau diese Buchung (ADR 0034). Die
 * Eingaben kommen im POST-Body der Server Action; an die API gehen nur Teilstrecke und die
 * Geschlechter der Buchung ohne Doppelte, ebenfalls im Body (`POST /trips/:id/seat-map`), nie in
 * einer URL. Nichts davon wird gespeichert oder geloggt. Ohne JavaScript schickt der Browser das
 * Formular selbst ab.
 */
export async function prepareSeats(_previous: SeatMapState, form: FormData): Promise<SeatMapState> {
  const at = Date.now();
  const request = buildSeatMapRequest(formValues(form));
  if (!request.ok) {
    return {
      status: 'invalid',
      code: request.malformed ? 'INVALID_FORM' : 'VALIDATION_FAILED',
      fields: request.fields,
      at,
    };
  }
  const result = await apiSend<SeatMapResponse>(`/trips/${request.tripId}/seat-map`, {
    method: 'POST',
    body: request.body,
  });
  return result.ok
    ? { status: 'loaded', seatMap: result.data, genders: request.genders, at }
    : { status: 'error', code: result.problem.code, at };
}

export type HoldState =
  | { status: 'idle' }
  | { status: 'held'; bookingId: string; token: string }
  | {
      status: 'error';
      code: string;
      /** Sitzbeschriftungen aus der API, etwa die inzwischen vergebenen Sitze. */
      seats: string[];
      /** Feldfehler nach Feldname; leer, wenn der Fehler die ganze Buchung betrifft. */
      fields: Record<string, FieldError>;
      /** Zeitpunkt der Antwort, damit ein gleicher Fehler erneut angesagt wird. */
      at: number;
    };

/**
 * Hält die gewählten Sitze (`POST /bookings`, Schritt 1.5). Fahrgast i bekommt den i-ten Sitz
 * (Zuordnung im Sitzplan, ADR 0034). Fahrgastdaten und Kontakt kommen im
 * POST-Body der Server Action und gehen im Body an die API, nie in eine URL; nichts davon wird
 * gespeichert oder geloggt. Der `Idempotency-Key` stammt aus der Seite: Eine Wiederholung nach
 * einem Netzfehler liefert dieselbe Buchung mit neuem Token (ADR 0020). Zurück an den Browser gehen
 * nur Buchungs-ID und Verwaltungstoken; die Seite öffnet damit „Zahlweg wählen", das Token im
 * Fragment.
 */
export async function holdSeats(_previous: HoldState, form: FormData): Promise<HoldState> {
  const at = Date.now();
  const request = buildBookingRequest(formValues(form));
  if (!request.ok) {
    return {
      status: 'error',
      code: request.malformed ? 'INVALID_FORM' : 'VALIDATION_FAILED',
      seats: [],
      fields: request.fields,
      at,
    };
  }
  const result = await apiSend<CreateBookingResponse>('/bookings', {
    method: 'POST',
    headers: { 'Idempotency-Key': request.idempotencyKey },
    body: request.body,
  });
  if (result.ok) {
    return {
      status: 'held',
      bookingId: result.data.booking.id,
      token: result.data.manageToken,
    };
  }
  const { problem } = result;
  return {
    status: 'error',
    code: problem.code,
    seats: problem.seats ?? [],
    fields:
      problem.code === 'VALIDATION_FAILED'
        ? fieldsFromApiPaths(problem.errorPaths ?? [], request.body.passengers.length)
        : {},
    at,
  };
}
