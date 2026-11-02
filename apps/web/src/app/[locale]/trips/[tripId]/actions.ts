'use server';

import { apiGet, apiSend } from '../../../../lib/api';
import type { FieldError } from '../../../../lib/booking';
import {
  buildBookingRequest,
  fieldsFromApiPaths,
  formValues,
} from '../../../../lib/booking-request';
import { isUuid } from '../../../../lib/search';
import type { CreateBookingResponse, SeatMapResponse } from '../../../../lib/types';

/** Für wen gebucht wird: eine Frau, ein Mann (auch mehrere gleichen Geschlechts) oder gemischt. */
export type Audience = 'FEMALE' | 'MALE' | 'GROUP';

export type SeatMapState =
  | { status: 'idle' }
  | { status: 'loaded'; audience: Audience; seatMap: SeatMapResponse; loadedAt: number }
  | { status: 'error'; code: string };

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

/**
 * Lädt den Sitzplan für die gewählte Personengruppe. Die Wahl kommt im POST-Body der Server Action
 * und geht nur als Query an die API, nie in die Seiten-URL, die Browser-Historie oder ein Log
 * (ADR 0019). Bei „gemischt" fragt die Seite ohne Geschlecht; die Regel prüft dann erst die
 * Buchung je Fahrgast. Ohne JavaScript schickt der Browser das Formular selbst ab.
 */
export async function loadSeatMap(_previous: SeatMapState, form: FormData): Promise<SeatMapState> {
  const tripId = field(form, 'tripId');
  const fromStopId = field(form, 'fromStopId');
  const toStopId = field(form, 'toStopId');
  const audience = field(form, 'audience');
  if (
    !isUuid(tripId) ||
    !isUuid(fromStopId) ||
    !isUuid(toStopId) ||
    (audience !== 'FEMALE' && audience !== 'MALE' && audience !== 'GROUP')
  ) {
    return { status: 'error', code: 'VALIDATION_FAILED' };
  }
  const result = await apiGet<SeatMapResponse>(`/trips/${tripId}/seat-map`, {
    fromStopId,
    toStopId,
    gender: audience === 'GROUP' ? undefined : audience,
  });
  return result.ok
    ? { status: 'loaded', audience, seatMap: result.data, loadedAt: Date.now() }
    : { status: 'error', code: result.problem.code };
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
 * Hält die gewählten Sitze (`POST /bookings`, Schritt 1.5). Fahrgastdaten und Kontakt kommen im
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
