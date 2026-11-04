'use client';

import { type Gender, isValidCalendarDate } from '@masar/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api, type Problem } from '../../../../lib/api';
import type { StaffBooking } from '../../../../lib/booking';
import {
  type ContactDraft,
  type CounterQuote,
  type CounterSeat,
  type CounterSeatMap,
  keepSellable,
  type PassengerDraft,
  quoteBody,
  type SaleField,
  saleBody,
  toggleSeat,
} from '../../../../lib/counter';
import { todayInDamascus, type TripSummary } from '../../../../lib/trips';

export type Failure = { problem: Problem; retryAfterSeconds?: number };

const EMPTY_CONTACT: ContactDraft = { name: '', phone: '', email: '' };

/**
 * Zustand und API-Aufrufe des Schalters (Schritt 2.6), ohne Darstellung: Fahrt wählen (Tag,
 * Strecke), Teilstrecke, Sitzplan, Sitzwahl mit Fahrgastdaten, Preisvorschau und Verkauf mit
 * `Idempotency-Key`. Die Komponenten unter `counter/` zeigen nur, was dieser Hook liefert; so
 * lässt sich das Aussehen austauschen, ohne den Ablauf anzufassen.
 *
 * Der Schlüssel gilt für genau einen Inhalt des Formulars: Ein zweiter Klick oder eine
 * Wiederholung nach Netzabbruch sendet denselben Schlüssel (dieselbe Buchung), eine geänderte
 * Auswahl einen neuen. Personendaten bleiben im Speicher dieser Seite.
 */
export function useCounter(companyId: string, locale: 'ar' | 'en') {
  const base = `/companies/${companyId}`;
  const [day, setDay] = useState(() => todayInDamascus());
  const [routeId, setRouteId] = useState('');
  const [trips, setTrips] = useState<TripSummary[]>();
  const [tripId, setTripId] = useState('');
  const [segment, setSegment] = useState<{ from: string; to: string } | null>(null);
  const [map, setMap] = useState<CounterSeatMap>();
  const [passengers, setPassengers] = useState<PassengerDraft[]>([]);
  const [contact, setContact] = useState<ContactDraft>(EMPTY_CONTACT);
  const [quote, setQuote] = useState<CounterQuote>();
  const [quoteFailure, setQuoteFailure] = useState<Failure>();
  const [failure, setFailure] = useState<Failure>();
  const [invalid, setInvalid] = useState<SaleField>();
  const [busy, setBusy] = useState(false);
  const [sold, setSold] = useState<StaffBooking>();
  const pendingKey = useRef<{ body: string; key: string } | null>(null);

  // Fahrten des Tages; nur geplante, die der Schalter verkaufen kann.
  useEffect(() => {
    // Ein halb getippter Tag lädt nichts; die Liste bleibt, bis der Tag gültig ist.
    if (!isValidCalendarDate(day)) return;
    let active = true;
    const query = new URLSearchParams({ from: day, to: day, status: 'SCHEDULED' });
    void api<{ items: TripSummary[] }>(`${base}/trips?${query.toString()}`).then((result) => {
      if (!active) return;
      if (result.ok) {
        setFailure(undefined);
        setTrips(result.data.items);
      } else {
        setFailure(result);
      }
    });
    return () => {
      active = false;
    };
  }, [base, day]);

  const loadMap = useCallback(
    async (id: string, range: { from: string; to: string } | null): Promise<void> => {
      const query =
        range === null
          ? ''
          : `?${new URLSearchParams({ fromStopId: range.from, toStopId: range.to }).toString()}`;
      const result = await api<CounterSeatMap>(`${base}/trips/${id}/counter-seat-map${query}`);
      if (result.ok) {
        setFailure(undefined);
        setMap(result.data);
        setPassengers((current) => keepSellable(current, result.data.seats));
      } else {
        setFailure(result);
      }
    },
    [base],
  );

  useEffect(() => {
    if (tripId === '') return;
    void loadMap(tripId, segment);
  }, [tripId, segment, loadMap]);

  // Preisvorschau, sobald Sitze gewählt sind; Geschlecht zählt mit, wenn angegeben.
  const quoteRequest = useMemo(
    () =>
      map === undefined || passengers.length === 0
        ? null
        : JSON.stringify(quoteBody(map, passengers)),
    [map, passengers],
  );
  useEffect(() => {
    if (quoteRequest === null) {
      setQuote(undefined);
      setQuoteFailure(undefined);
      return;
    }
    let active = true;
    void api<CounterQuote>(`${base}/counter/quote`, {
      method: 'POST',
      body: JSON.parse(quoteRequest) as unknown,
    }).then((result) => {
      if (!active) return;
      if (result.ok) {
        setQuote(result.data);
        setQuoteFailure(undefined);
      } else {
        setQuote(undefined);
        setQuoteFailure(result);
      }
    });
    return () => {
      active = false;
    };
  }, [base, quoteRequest]);

  const routes = useMemo(() => {
    const seen = new Map<string, TripSummary['route']>();
    for (const trip of trips ?? []) seen.set(trip.route.id, trip.route);
    return [...seen.values()];
  }, [trips]);

  const visibleTrips = useMemo(
    () => (trips ?? []).filter((trip) => routeId === '' || trip.route.id === routeId),
    [trips, routeId],
  );

  function chooseDay(value: string): void {
    setDay(value);
    if (isValidCalendarDate(value)) {
      setTrips(undefined);
      setTripId('');
      setMap(undefined);
      setPassengers([]);
    }
  }

  function chooseTrip(id: string): void {
    setTripId(id);
    setSegment(null);
    setMap(undefined);
    setPassengers([]);
    setSold(undefined);
  }

  function chooseStops(from: string, to: string): void {
    // Liegt der neue Einstieg nicht mehr vor dem Ausstieg, gilt der letzte Halt als Ausstieg.
    const stops = map?.trip.stops ?? [];
    const fromSeq = stops.find((stop) => stop.tripStopId === from)?.seq ?? 0;
    const toSeq = stops.find((stop) => stop.tripStopId === to)?.seq ?? 0;
    const last = stops.at(-1)?.tripStopId ?? to;
    setSegment({ from, to: toSeq > fromSeq ? to : last });
  }

  function toggle(seat: CounterSeat): void {
    if (map === undefined) return;
    setInvalid(undefined);
    setPassengers((current) => toggleSeat(current, seat, map.seats));
  }

  function updatePassenger(
    seatId: string,
    field: 'fullName' | 'gender' | 'nationalId',
    value: string,
  ): void {
    setPassengers((current) =>
      current.map((entry) =>
        entry.seatId === seatId
          ? { ...entry, [field]: field === 'gender' ? (value as '' | Gender) : value }
          : entry,
      ),
    );
  }

  function updateContact(field: keyof ContactDraft, value: string): void {
    setContact((current) => ({ ...current, [field]: value }));
  }

  async function sell(): Promise<void> {
    if (map === undefined) return;
    const built = saleBody({ map, contact, passengers, locale });
    if (!built.ok) {
      setInvalid(built.field);
      return;
    }
    setInvalid(undefined);
    const text = JSON.stringify(built.body);
    if (pendingKey.current?.body !== text) {
      pendingKey.current = { body: text, key: crypto.randomUUID() };
    }
    setBusy(true);
    const result = await api<{ booking: StaffBooking }>(`${base}/counter/sales`, {
      method: 'POST',
      body: built.body,
      headers: { 'Idempotency-Key': pendingKey.current.key },
    });
    setBusy(false);
    if (!result.ok) {
      setFailure(result);
      // Belegt oder Regelkonflikt: Sitzplan neu laden, damit das Personal neu wählen kann.
      void loadMap(map.trip.id, { from: map.from.tripStopId, to: map.to.tripStopId });
      return;
    }
    pendingKey.current = null;
    setFailure(undefined);
    setSold(result.data.booking);
    setPassengers([]);
    setContact(EMPTY_CONTACT);
    void loadMap(map.trip.id, { from: map.from.tripStopId, to: map.to.tripStopId });
  }

  /** Nächster Verkauf auf derselben Fahrt und Teilstrecke. */
  function startOver(): void {
    setSold(undefined);
  }

  return {
    day,
    routeId,
    routes,
    trips: trips === undefined ? undefined : visibleTrips,
    tripId,
    map,
    passengers,
    contact,
    quote,
    quoteFailure,
    failure,
    invalid,
    busy,
    sold,
    chooseDay,
    chooseRoute: setRouteId,
    chooseTrip,
    chooseStops,
    toggle,
    updatePassenger,
    updateContact,
    sell,
    startOver,
  };
}

export type CounterState = ReturnType<typeof useCounter>;
