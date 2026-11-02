'use client';

import type { Locale, SeatState } from '@masar/shared';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, startTransition, useActionState, useState } from 'react';

import {
  type Audience,
  loadSeatMap,
  type SeatMapState,
} from '../app/[locale]/trips/[tripId]/actions';
import { formatFare } from '../lib/format';
import {
  buildSeatGrid,
  isSelectable,
  keepSelectable,
  type SeatCell,
  toggleSeat,
} from '../lib/seat-layout';
import type { SeatMapResponse } from '../lib/types';
import { ProblemNotice } from './problem-notice';

type VisualState = SeatState | 'SELECTED';

/**
 * Klassen je Sitzstatus. Nicht nur die Farbe unterscheidet: Rahmen (durchgehend, gestrichelt,
 * gepunktet) und Durchstreichung tragen dieselbe Information für Menschen mit Farbsehschwäche.
 */
const STATE_CLASSES: Record<VisualState, string> = {
  FREE: 'border-solid border-brand-500 bg-white text-brand-800 hover:bg-brand-50 cursor-pointer',
  SELECTED: 'border-solid border-brand-800 bg-brand-600 text-white cursor-pointer',
  TAKEN: 'border-solid border-slate-400 bg-slate-300 text-slate-600 line-through',
  NOT_ONLINE: 'border-dashed border-slate-400 bg-slate-50 text-slate-500',
  BLOCKED: 'border-solid border-slate-200 bg-slate-100 text-slate-300',
  NOT_FOR_YOU: 'border-dotted border-rose-400 bg-rose-50 text-rose-500',
};

/** Feste Klassen statt Inline-Styles: Tailwind findet sie im Quelltext, und die CSP bleibt streng. */
const GRID_COLUMNS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
  5: 'grid-cols-5',
  6: 'grid-cols-6',
  7: 'grid-cols-7',
  8: 'grid-cols-8',
  9: 'grid-cols-9',
};
const COLUMN_START: Record<number, string> = {
  1: 'col-start-1',
  2: 'col-start-2',
  3: 'col-start-3',
  4: 'col-start-4',
  5: 'col-start-5',
  6: 'col-start-6',
  7: 'col-start-7',
  8: 'col-start-8',
  9: 'col-start-9',
};

const FOCUS_RING =
  'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-600';

export interface SeatPickerProps {
  tripId: string;
  fromStopId: string;
  toStopId: string;
  passengers: number;
  genderRuleEnabled: boolean;
  /** Sitzplan ohne Geschlecht; nur nötig, wenn die Fahrt keine Geschlechtsregel hat. */
  initialSeatMap: SeatMapResponse | null;
}

/**
 * Sitzwahl in zwei Schritten: zuerst „Ich buche für", dann das Sitzgitter. Die Wahl lebt nur im
 * Zustand dieser Komponente (ADR 0019). Sitze sind native Checkboxen: Tab und Leertaste reichen,
 * Screenreader hören Sitz und Status.
 */
export function SeatPicker(props: SeatPickerProps): ReactNode {
  const t = useTranslations('trip');
  const ruleEnabled = props.genderRuleEnabled;
  const initial: SeatMapState =
    ruleEnabled || props.initialSeatMap === null
      ? { status: 'idle' }
      : { status: 'loaded', audience: 'GROUP', seatMap: props.initialSeatMap, loadedAt: 0 };
  const [state, formAction, pending] = useActionState(loadSeatMap, initial);
  // Gesteuert, weil React Formulare nach einer Action zurücksetzt; ohne JavaScript gilt der Zustand
  // der Action (der Server rendert die Seite mit der gewählten Gruppe neu).
  const [chosenAudience, setChosenAudience] = useState<Audience | null>(null);
  const audience = chosenAudience ?? (state.status === 'loaded' ? state.audience : null);
  const audiences: Audience[] =
    props.passengers === 1 ? ['FEMALE', 'MALE'] : ['FEMALE', 'MALE', 'GROUP'];

  return (
    <div className="flex flex-col gap-6">
      {ruleEnabled ? (
        <form
          // Ohne JavaScript schickt der Browser das Formular an die Server Action.
          action={formAction}
          // Mit JavaScript selbst auslösen: So setzt React das Formular danach nicht zurück, und die
          // gewählte Gruppe bleibt markiert.
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            startTransition(() => formAction(data));
          }}
          className="flex flex-col gap-3"
        >
          <input type="hidden" name="tripId" value={props.tripId} />
          <input type="hidden" name="fromStopId" value={props.fromStopId} />
          <input type="hidden" name="toStopId" value={props.toStopId} />
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-lg font-semibold">{t('audienceLegend')}</legend>
            <p id="audience-hint" className="text-sm text-slate-600">
              {t('audienceHint')}
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {audiences.map((option) => (
                <label key={option} className="relative">
                  <input
                    type="radio"
                    name="audience"
                    value={option}
                    required
                    checked={audience === option}
                    aria-describedby="audience-hint"
                    className="peer sr-only"
                    // Mit JavaScript lädt die Wahl sofort; ohne bleibt die Schaltfläche darunter.
                    onChange={(event) => {
                      setChosenAudience(option);
                      event.currentTarget.form?.requestSubmit();
                    }}
                  />
                  <span
                    className={`flex min-h-12 cursor-pointer items-center justify-center rounded-xl border-2 border-slate-300 bg-white px-3 py-2 text-center font-medium peer-checked:border-brand-600 peer-checked:bg-brand-50 peer-checked:text-brand-900 ${FOCUS_RING}`}
                  >
                    {props.passengers === 1
                      ? t(`audienceSingle.${option as 'FEMALE' | 'MALE'}`)
                      : t(`audienceMany.${option}`)}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <button
            type="submit"
            disabled={pending}
            className="self-start rounded-xl border border-brand-600 px-4 py-2 font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            {t('showSeats')}
          </button>
        </form>
      ) : null}

      {pending ? (
        <p role="status" className="text-slate-600">
          {t('loadingSeats')}
        </p>
      ) : null}
      {state.status === 'error' ? <ProblemNotice code={state.code} /> : null}
      {state.status === 'loaded' ? (
        <SeatSelection
          key={state.loadedAt}
          seatMap={state.seatMap}
          passengers={props.passengers}
          groupNote={ruleEnabled && state.audience === 'GROUP'}
          busy={pending}
        />
      ) : null}
    </div>
  );
}

function SeatSelection({
  seatMap,
  passengers,
  groupNote,
  busy,
}: {
  seatMap: SeatMapResponse;
  passengers: number;
  groupNote: boolean;
  busy: boolean;
}): ReactNode {
  const t = useTranslations('trip');
  const locale = useLocale() as Locale;
  const [chosen, setChosen] = useState<string[]>([]);
  const selected = keepSelectable(chosen, seatMap.seats);
  const grid = buildSeatGrid(seatMap.seats);
  const full = selected.length >= passengers;
  const freeCount = seatMap.seats.filter((seat) => isSelectable(seat.state)).length;
  const labels = selected
    .map((id) => seatMap.seats.find((seat) => seat.seatId === id)?.label)
    .filter((label) => label !== undefined);
  const legend: VisualState[] = [
    'FREE',
    'SELECTED',
    'TAKEN',
    'NOT_ONLINE',
    'BLOCKED',
    ...(seatMap.genderRule.applied ? (['NOT_FOR_YOU'] as const) : []),
  ];

  const renderCell = ({ seat, track }: SeatCell): ReactNode => {
    const isChosen = selected.includes(seat.seatId);
    const visual: VisualState = isChosen ? 'SELECTED' : seat.state;
    const id = `seat-${seat.seatId}`;
    return (
      <div key={seat.seatId} className={`${COLUMN_START[track] ?? ''} relative row-start-1`}>
        <input
          type="checkbox"
          id={id}
          name="seatId"
          value={seat.seatId}
          checked={isChosen}
          disabled={busy || !isSelectable(seat.state) || (!isChosen && full)}
          onChange={() => setChosen(toggleSeat(selected, seat.seatId, passengers))}
          aria-label={t('seatName', { label: seat.label, state: t(`states.${visual}`) })}
          className="peer sr-only"
        />
        <label
          htmlFor={id}
          className={`flex h-12 w-full items-center justify-center rounded-lg border-2 text-sm font-semibold peer-disabled:cursor-not-allowed ${STATE_CLASSES[visual]} ${FOCUS_RING}`}
        >
          {seat.label}
        </label>
      </div>
    );
  };

  return (
    <section aria-labelledby="seat-map-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="seat-map-heading" className="text-lg font-semibold">
          {t('seatMapHeading')}
        </h2>
        <p className="text-sm text-slate-600">{t('seatMapHint')}</p>
        {groupNote ? <p className="text-sm text-slate-600">{t('groupNote')}</p> : null}
      </div>

      {freeCount < passengers ? (
        <p role="alert" className="rounded-xl bg-amber-50 p-3 text-amber-900">
          {t('noFreeSeats')}
        </p>
      ) : null}

      {/* Der Bus ist ein Grundriss: links bleibt links, auch auf Arabisch. */}
      <div
        dir="ltr"
        className="mx-auto flex w-full max-w-80 flex-col gap-2 rounded-3xl border-2 border-slate-300 bg-white p-3"
      >
        <div className="flex items-center gap-2 rounded-t-2xl bg-slate-100 px-3 py-2 text-xs text-slate-600">
          <span aria-hidden="true" className="size-5 rounded-full border-4 border-slate-400" />
          <span className="flex-1 text-center">{t('front')}</span>
          <span aria-hidden="true" className="size-5" />
        </div>
        {grid.rows.map((row) => (
          <div
            key={row.number}
            role="group"
            aria-label={row.bench ? t('bench') : t('row', { number: String(row.number) })}
            className={`grid gap-1.5 ${GRID_COLUMNS[grid.tracks] ?? 'grid-cols-5'} ${row.bench ? 'mt-1 rounded-xl bg-slate-100 p-1' : ''}`}
          >
            {row.cells.map(renderCell)}
            {!row.bench && grid.aisleTrack !== null ? (
              <span
                aria-hidden="true"
                className={`${COLUMN_START[grid.aisleTrack] ?? ''} row-start-1 flex items-center justify-center text-xs text-slate-400`}
              >
                {String(row.number)}
              </span>
            ) : null}
          </div>
        ))}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-700">{t('legendHeading')}</h3>
        <ul className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
          {legend.map((key) => (
            <li key={key} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={`size-5 shrink-0 rounded border-2 ${STATE_CLASSES[key]}`}
              />
              {t(`legend.${key}`)}
            </li>
          ))}
        </ul>
      </div>

      <section
        aria-labelledby="summary-heading"
        className="sticky bottom-0 flex flex-col gap-2 rounded-t-2xl border border-slate-200 bg-white p-4 shadow-lg"
      >
        <h2 id="summary-heading" className="font-semibold">
          {t('summaryHeading')}
        </h2>
        <p role="status" className="text-sm text-slate-700">
          {t('selectionStatus', { selected: String(selected.length), max: String(passengers) })}
          {full ? ` ${t('maxReached')}` : ''}
        </p>
        <p className="text-sm">
          {labels.length === 0
            ? t('noSeatsYet')
            : t('chosenSeats', { labels: labels.join(locale === 'ar' ? '، ' : ', ') })}
        </p>
        {labels.length > 0 ? (
          <p className="font-semibold">
            {t('total', { price: formatFare(seatMap.fare, locale, labels.length) })}
          </p>
        ) : null}
        <button
          type="button"
          disabled
          aria-describedby="continue-hint"
          className="rounded-xl bg-brand-600 px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600"
        >
          {t('continue')}
        </button>
        <p id="continue-hint" className="text-xs text-slate-600">
          {t('continueHint')}
        </p>
      </section>
    </section>
  );
}
