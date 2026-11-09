'use client';

import type { Gender, Locale } from '@masar/shared';
import { useLocale, useTranslations } from 'next-intl';
import {
  type FormEvent,
  type ReactNode,
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  holdSeats,
  type HoldState,
  prepareSeats,
  type SeatMapState,
} from '../app/[locale]/trips/[tripId]/actions';
import {
  type FieldError,
  idempotencyKeyFrom,
  isBookingProblem,
  isSeatProblem,
  passengerField,
  payHref,
} from '../lib/booking';
import {
  completeSeats,
  emptyAssignment,
  keepValidAssignment,
  nextPassenger,
  toggleSeatFor,
} from '../lib/seat-assignment';
import type { SeatMapResponse, SeatView } from '../lib/types';
import { type Draft, draftFromForm, PassengerForm } from './passenger-form';
import { ProblemNotice } from './problem-notice';
import { SeatPicker } from './seat-picker';

export interface BookingFlowProps {
  tripId: string;
  fromStopId: string;
  toStopId: string;
  passengers: number;
  genderRuleEnabled: boolean;
  nationalIdRequired: boolean;
  companyName: string;
}

/** Codes, nach denen die Fahrgastdaten zu korrigieren sind, nicht die Sitze. */
const DETAIL_CODES = new Set([
  'VALIDATION_FAILED',
  'INVALID_FORM',
  'GENDER_REQUIRED',
  'NATIONAL_ID_REQUIRED',
]);

interface Problem {
  code: string;
  seats: string[];
  fields: Record<string, FieldError>;
  at: number;
}

const initialSeats: SeatMapState = { status: 'idle' };
const initialHold: HoldState = { status: 'idle' };

function newIdempotencyKey(): string {
  return idempotencyKeyFrom(crypto.getRandomValues(new Uint8Array(16)));
}

/**
 * Buchungsablauf auf der Fahrt-Seite (ADR 0034): erst die Fahrgastdaten mit Geschlecht je Person,
 * dann der Sitzplan für genau diese Buchung, Sitz je Fahrgast, dann der Hold. Eingaben, Geschlechter
 * und Sitze leben nur im Zustand dieser Komponente, nie in URL, Verlauf oder Browser-Speicher. Nach
 * dem Hold lädt die Seite „Zahlweg wählen" vollständig neu; damit ist der Zustand verworfen.
 */
export function BookingFlow(props: BookingFlowProps): ReactNode {
  const tBooking = useTranslations('booking');
  const locale = useLocale() as Locale;
  const [step, setStep] = useState<'details' | 'seats'>('details');
  // Vom Sitzplan zurück zu den Fahrgastdaten: dann bekommt deren Überschrift den Fokus.
  const [returned, setReturned] = useState(false);
  const [draft, setDraft] = useState<Draft>({});
  const [seatsState, prepareAction, preparing] = useActionState(prepareSeats, initialSeats);
  const [holdState, holdAction, holding] = useActionState(holdSeats, initialHold);
  const [plan, setPlan] = useState<{
    seatMap: SeatMapResponse;
    genders: (Gender | null)[];
  } | null>(null);
  const [assignment, setAssignment] = useState<(string | null)[]>(() =>
    emptyAssignment(props.passengers),
  );
  const [active, setActive] = useState(0);
  const [detailsProblem, setDetailsProblem] = useState<Problem | null>(null);
  const [seatsProblem, setSeatsProblem] = useState<Problem | null>(null);
  // Ein Schlüssel je Sitzzuordnung und Eingaben: Wiederholt der Fahrgast nach einem Netzfehler
  // dieselbe Anfrage, liefert die API dieselbe Buchung statt eines zweiten Holds (ADR 0020).
  const idempotency = useRef<{ key: string; signature: string } | null>(null);
  const href =
    holdState.status === 'held' ? payHref(locale, holdState.bookingId, holdState.token) : null;

  /** Versteckte Felder plus Eingaben aus dem Speicher, für Sitzplan und Hold. */
  function baseForm(from: Draft): FormData {
    const data = new FormData();
    data.set('tripId', props.tripId);
    data.set('fromStopId', props.fromStopId);
    data.set('toStopId', props.toStopId);
    data.set('passengerCount', String(props.passengers));
    data.set('genderRule', props.genderRuleEnabled ? '1' : '0');
    data.set('nationalIdRequired', props.nationalIdRequired ? '1' : '0');
    for (const [name, value] of Object.entries(from)) {
      data.set(name, value);
    }
    return data;
  }

  function submitDetails(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setDraft(draftFromForm(data, locale));
    startTransition(() => prepareAction(data));
  }

  // Antwort auf „Weiter zur Sitzwahl" oder auf das Neuladen nach einem Sitzfehler.
  const seatsAt = seatsState.status === 'idle' ? null : seatsState.at;
  useEffect(() => {
    if (seatsState.status === 'idle') return;
    if (seatsState.status === 'loaded') {
      const kept = keepValidAssignment(assignment, seatsState.seatMap.seats, seatsState.genders);
      setPlan({ seatMap: seatsState.seatMap, genders: seatsState.genders });
      setAssignment(kept);
      setActive(kept[0] === null ? 0 : nextPassenger(kept, 0));
      setDetailsProblem(null);
      setStep('seats');
      window.scrollTo({ top: 0 });
      return;
    }
    const problem: Problem = {
      code: seatsState.code,
      seats: [],
      fields: seatsState.status === 'invalid' ? seatsState.fields : {},
      at: seatsState.at,
    };
    if (seatsState.status === 'invalid' || step === 'details') {
      setDetailsProblem(problem);
      setStep('details');
    } else {
      setSeatsProblem(problem);
    }
    // Nur je neuer Antwort (`at`); die übrigen Werte sind der Stand in genau diesem Moment.
  }, [seatsAt]);

  // Antwort auf „Sitze reservieren".
  const holdAt = holdState.status === 'error' ? holdState.at : null;
  useEffect(() => {
    if (href !== null) {
      // Volle Navigation: Die Seite „Zahlweg wählen" liest das Token aus dem Fragment.
      window.location.assign(href);
    }
  }, [href]);
  useEffect(() => {
    if (holdState.status !== 'error') return;
    const problem: Problem = {
      code: holdState.code,
      seats: holdState.seats,
      fields: holdState.fields,
      at: holdState.at,
    };
    if (holdState.code === 'IDEMPOTENCY_KEY_REUSED') {
      idempotency.current = null;
    }
    if (DETAIL_CODES.has(holdState.code) || Object.keys(holdState.fields).length > 0) {
      setDetailsProblem(problem);
      setStep('details');
      return;
    }
    setSeatsProblem(problem);
    if (isSeatProblem(holdState.code)) {
      // Neu laden, damit inzwischen vergebene Sitze als belegt erscheinen.
      startTransition(() => prepareAction(baseForm(draft)));
    }
    // Nur je neuer Fehlerantwort (`at`).
  }, [holdAt]);

  function toggle(seat: SeatView): void {
    if (plan === null) return;
    const gender = plan.genders[active] ?? null;
    const next = toggleSeatFor(assignment, active, seat, gender);
    setAssignment(next);
    if (next[active] !== null && next[active] !== assignment[active]) {
      setActive(nextPassenger(next, active));
    }
  }

  function hold(): void {
    const seats = completeSeats(assignment);
    if (seats === null) return;
    const signature = JSON.stringify([seats, draft]);
    if (idempotency.current?.signature !== signature) {
      idempotency.current = { key: newIdempotencyKey(), signature };
    }
    const data = baseForm(draft);
    data.set('idempotencyKey', idempotency.current.key);
    for (const seatId of seats) {
      data.append('seatId', seatId);
    }
    setSeatsProblem(null);
    startTransition(() => holdAction(data));
  }

  if (step === 'seats' && plan !== null) {
    return (
      <SeatPicker
        seatMap={plan.seatMap}
        genders={plan.genders}
        names={assignment.map((_, index) =>
          (draft[passengerField(index, 'fullName')] ?? '').trim(),
        )}
        assignment={assignment}
        active={active}
        onActive={setActive}
        onToggle={toggle}
        busy={preparing}
        holding={holding}
        notice={seatsProblem === null ? null : <SeatsNotice problem={seatsProblem} />}
        noticeAt={seatsProblem?.at ?? null}
        onHold={hold}
        onEditDetails={() => {
          setSeatsProblem(null);
          setDetailsProblem(null);
          setReturned(true);
          setStep('details');
        }}
        payHref={href}
      />
    );
  }

  return (
    <PassengerForm
      action={prepareAction}
      onSubmit={submitDetails}
      pending={preparing}
      tripId={props.tripId}
      fromStopId={props.fromStopId}
      toStopId={props.toStopId}
      passengers={props.passengers}
      genderRuleEnabled={props.genderRuleEnabled}
      nationalIdRequired={props.nationalIdRequired}
      companyName={props.companyName}
      draft={draft}
      fields={detailsProblem?.fields ?? {}}
      notice={
        detailsProblem === null ? null : isBookingProblem(detailsProblem.code) ? (
          <div role="alert" className="rounded-lg bg-red-50 p-4 text-red-900">
            {tBooking(`problems.${detailsProblem.code}`)}
          </div>
        ) : (
          <ProblemNotice code={detailsProblem.code} />
        )
      }
      noticeAt={detailsProblem?.at ?? null}
      focusHeading={returned}
    />
  );
}

/** Hinweis über dem Sitzplan nach einem Fehler beim Hold. */
function SeatsNotice({ problem }: { problem: Problem }): ReactNode {
  const t = useTranslations('booking');
  const locale = useLocale() as Locale;
  if (!isBookingProblem(problem.code)) {
    return <ProblemNotice code={problem.code} />;
  }
  return (
    <div role="alert" className="rounded-lg bg-red-50 p-4 text-red-900">
      {isSeatProblem(problem.code) && problem.seats.length > 0
        ? t(`seatProblems.${problem.code}`, {
            seats: problem.seats.join(locale === 'ar' ? '، ' : ', '),
          })
        : t(`problems.${problem.code}`)}
    </div>
  );
}
