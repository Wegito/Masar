import { type Gender, normalizePhone, type SeatSide, type TripStatus } from '@masar/shared';

/**
 * Schaltermodus im Portal (Schritt 2.6, ADR 0030): Typen der API-Antworten und reine Helfer für
 * Sitzwahl, Fahrgastdaten und den Body des Verkaufs (docs/api-konventionen.md, Abschnitt
 * „Schalter"). Verbindlich prüft die API; die Helfer verhindern nur unvollständige Anfragen.
 * Darstellung und Zustand liegen getrennt (`app/[locale]/(app)/counter/`).
 */

/** Höchstzahl Fahrgäste je Buchung, wie `MAX_SEATS_PER_BOOKING` in der API. */
export const MAX_COUNTER_SEATS = 9;

export interface CounterStop {
  tripStopId: string;
  seq: number;
  nameAr: string;
  nameEn: string;
  arrivalAt: string | null;
  departureAt: string | null;
}

export type CounterQuota = 'ONLINE' | 'COUNTER' | 'BLOCKED';
export type CounterSeatState = 'FREE' | 'TAKEN' | 'BLOCKED';

export interface CounterSeat {
  seatId: string;
  label: string;
  row: number;
  column: number;
  side: SeatSide;
  quota: CounterQuota;
  state: CounterSeatState;
  occupiedRanges: { fromSeq: number; toSeq: number }[];
  selectableFor: Record<Gender, boolean> | null;
}

export interface CounterSeatMap {
  trip: {
    id: string;
    status: TripStatus;
    departureAt: string;
    arrivalAt: string;
    route: { id: string; nameAr: string; nameEn: string };
    bus: { id: string; plate: string } | null;
    stops: CounterStop[];
  };
  from: CounterStop;
  to: CounterStop;
  fare: { amountMinor: number; currency: string } | null;
  salesOpen: boolean;
  genderRuleEnabled: boolean;
  nationalIdRequired: boolean;
  layout: { rows: number; columns: number };
  seats: CounterSeat[];
  summary: { free: number; taken: number; blocked: number; counterOnly: number };
}

export interface CounterQuote {
  seats: { seatId: string; label: string }[];
  fare: { amountMinor: number; currency: string };
  total: { amountMinor: number; currency: string };
}

/** Ticket zum Drucken (`GET …/bookings/:id/ticket`), wie die Ticketseite der Fahrgast-App. */
export interface PrintTicket {
  id: string;
  bookingCode: string;
  status: string;
  total: { amountMinor: number; currency: string };
  trip: {
    id: string;
    status: TripStatus;
    departureAt: string;
    company: { id: string; nameAr: string; nameEn: string };
  };
  from: { nameAr: string; nameEn: string; departureAt: string | null };
  to: { nameAr: string; nameEn: string; arrivalAt: string | null };
  passengers: { id: string; seatLabel: string; fullName: string; status: string }[];
  tickets: {
    id: string;
    passengerId: string;
    seatLabel: string;
    status: string;
    qrToken: string | null;
  }[];
  confirmedAt: string | null;
}

/** Ein Fahrgast je gewähltem Sitz, wie im Formular; leere Felder sind noch nicht ausgefüllt. */
export interface PassengerDraft {
  seatId: string;
  label: string;
  fullName: string;
  gender: '' | Gender;
  nationalId: string;
}

export interface ContactDraft {
  name: string;
  phone: string;
  email: string;
}

/** Kann der Schalter den Sitz für diese Teilstrecke verkaufen? */
export function isSeatSellable(seat: CounterSeat): boolean {
  return seat.state === 'FREE';
}

/**
 * Sitz an- oder abwählen. Nur freie Sitze, höchstens {@link MAX_COUNTER_SEATS}; die Reihenfolge
 * folgt dem Sitzplan (Reihe, dann Spalte), damit Formular und Ticket gleich sortiert sind.
 * Bereits eingegebene Fahrgastdaten bleiben beim Abwählen anderer Sitze erhalten.
 */
export function toggleSeat(
  selection: readonly PassengerDraft[],
  seat: CounterSeat,
  seats: readonly CounterSeat[],
): PassengerDraft[] {
  if (selection.some((entry) => entry.seatId === seat.seatId)) {
    return selection.filter((entry) => entry.seatId !== seat.seatId);
  }
  if (!isSeatSellable(seat) || selection.length >= MAX_COUNTER_SEATS) {
    return [...selection];
  }
  const order = new Map(seats.map((entry, index) => [entry.seatId, index]));
  const added: PassengerDraft = {
    seatId: seat.seatId,
    label: seat.label,
    fullName: '',
    gender: '',
    nationalId: '',
  };
  return [...selection, added].sort(
    (a, b) => (order.get(a.seatId) ?? 0) - (order.get(b.seatId) ?? 0),
  );
}

/** Auswahl nach neuem Sitzplan: Sitze, die nicht mehr frei sind, fallen heraus. */
export function keepSellable(
  selection: readonly PassengerDraft[],
  seats: readonly CounterSeat[],
): PassengerDraft[] {
  const free = new Set(seats.filter(isSeatSellable).map((seat) => seat.seatId));
  return selection.filter((entry) => free.has(entry.seatId));
}

/**
 * Hinweis vor dem Absenden: Der Sitz ist für dieses Geschlecht nach der Regel nicht wählbar.
 * Fahrgäste derselben Buchung sind ausgenommen (ADR 0006); deshalb nur ein Hinweis, die API
 * entscheidet.
 */
export function genderWarning(seat: CounterSeat | undefined, gender: '' | Gender): boolean {
  if (seat?.selectableFor == null || gender === '') return false;
  return !seat.selectableFor[gender];
}

export type SaleField = 'seats' | 'contactName' | 'phone' | 'passengers';

/**
 * Body für `POST …/counter/sales` aus dem Formular. Leerer Name eines Fahrgasts übernimmt den
 * Namen der Kontaktperson (häufig am Schalter: eine Person reist allein).
 */
export function saleBody(input: {
  map: Pick<CounterSeatMap, 'trip' | 'from' | 'to' | 'genderRuleEnabled' | 'nationalIdRequired'>;
  contact: ContactDraft;
  passengers: readonly PassengerDraft[];
  locale: 'ar' | 'en';
}): { ok: true; body: Record<string, unknown> } | { ok: false; field: SaleField } {
  if (input.passengers.length === 0) return { ok: false, field: 'seats' };
  const name = input.contact.name.trim();
  if (name.length < 2) return { ok: false, field: 'contactName' };
  const phone = normalizePhone(input.contact.phone);
  if (!phone.ok) return { ok: false, field: 'phone' };
  const passengers = [];
  for (const passenger of input.passengers) {
    const fullName = passenger.fullName.trim() === '' ? name : passenger.fullName.trim();
    if (fullName.length < 2) return { ok: false, field: 'passengers' };
    if (input.map.genderRuleEnabled && passenger.gender === '') {
      return { ok: false, field: 'passengers' };
    }
    if (input.map.nationalIdRequired && passenger.nationalId.trim() === '') {
      return { ok: false, field: 'passengers' };
    }
    passengers.push({
      seatId: passenger.seatId,
      fullName,
      ...(passenger.gender === '' ? {} : { gender: passenger.gender }),
      // Nur wenn verlangt (ADR 0016, Datenminimierung).
      ...(input.map.nationalIdRequired ? { nationalId: passenger.nationalId.trim() } : {}),
    });
  }
  const email = input.contact.email.trim();
  return {
    ok: true,
    body: {
      tripId: input.map.trip.id,
      fromStopId: input.map.from.tripStopId,
      toStopId: input.map.to.tripStopId,
      locale: input.locale,
      contact: { name, phone: phone.e164, ...(email === '' ? {} : { email }) },
      passengers,
    },
  };
}

/** Body der Preisvorschau: Sitze mit Geschlecht, sobald es angegeben ist. */
export function quoteBody(
  map: Pick<CounterSeatMap, 'trip' | 'from' | 'to'>,
  passengers: readonly PassengerDraft[],
): Record<string, unknown> {
  return {
    tripId: map.trip.id,
    fromStopId: map.from.tripStopId,
    toStopId: map.to.tripStopId,
    seats: passengers.map((passenger) => ({
      seatId: passenger.seatId,
      ...(passenger.gender === '' ? {} : { gender: passenger.gender }),
    })),
  };
}

/**
 * Belegte Teilstrecken eines Sitzes als Paare von Halten (`[von, bis]`), für die Anzeige
 * „belegt Damaskus → Homs". Unbekannte Positionen fallen weg.
 */
export function occupiedStopPairs<T extends { seq: number }>(
  ranges: readonly { fromSeq: number; toSeq: number }[],
  stops: readonly T[],
): [T, T][] {
  const bySeq = new Map(stops.map((stop) => [stop.seq, stop]));
  return ranges.flatMap((range) => {
    const from = bySeq.get(range.fromSeq);
    const to = bySeq.get(range.toSeq);
    return from === undefined || to === undefined ? [] : [[from, to] as [T, T]];
  });
}

/** Fehler am Schalter: Laden (Fahrten, Sitzplan) und Verkauf getrennt. */
export interface CounterFailures<F> {
  load?: F;
  sale?: F;
}

export type CounterFailureEvent<F> =
  | { type: 'loadOk' }
  | { type: 'loadFailed'; failure: F }
  | { type: 'saleStarted' }
  | { type: 'saleFailed'; failure: F }
  | { type: 'saleOk' }
  | { type: 'selectionChanged' };

/**
 * Nächster Fehlerzustand. Der Verkaufsfehler bleibt stehen, wenn der Sitzplan danach neu lädt
 * (auch wenn das Neuladen scheitert); er geht erst beim nächsten Versuch, bei einer geänderten
 * Auswahl oder nach einem Erfolg.
 */
export function nextFailures<F>(
  state: CounterFailures<F>,
  event: CounterFailureEvent<F>,
): CounterFailures<F> {
  switch (event.type) {
    case 'loadOk':
      return state.sale === undefined ? {} : { sale: state.sale };
    case 'loadFailed':
      return { ...state, load: event.failure };
    case 'saleFailed':
      return { ...state, sale: event.failure };
    case 'saleStarted':
    case 'saleOk':
    case 'selectionChanged':
      return state.load === undefined ? {} : { load: state.load };
  }
}

/**
 * Nur die jüngste Anfrage zählt: `begin` vergibt eine Kennung, `isCurrent` prüft sie bei der
 * Antwort, `invalidate` verwirft alle laufenden (etwa nach einem Wechsel der Fahrt).
 */
export function createLatestGate(): {
  begin: () => number;
  isCurrent: (ticket: number) => boolean;
  invalidate: () => void;
} {
  let current = 0;
  return {
    begin: () => {
      current += 1;
      return current;
    },
    isCurrent: (ticket) => ticket === current,
    invalidate: () => {
      current += 1;
    },
  };
}
