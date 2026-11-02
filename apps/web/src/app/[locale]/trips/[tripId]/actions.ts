'use server';

import { apiGet } from '../../../../lib/api';
import { isUuid } from '../../../../lib/search';
import type { SeatMapResponse } from '../../../../lib/types';

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
