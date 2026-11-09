'use client';

import type { Gender, Locale } from '@masar/shared';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useRef } from 'react';

import { formatFare } from '../lib/format';
import {
  type Assignment,
  assignedCount,
  passengerOfSeat,
  seatStateFor,
  selectableSeatCount,
} from '../lib/seat-assignment';
import { buildSeatGrid, type SeatCell } from '../lib/seat-layout';
import type { SeatMapResponse, SeatView } from '../lib/types';

/**
 * Darstellung je Sitz für den gerade gewählten Fahrgast. `NOT_FOR_YOU` (Geschlechtsregel) erscheint
 * wie `BLOCKED`: Der Sitz ist einfach nicht wählbar, ohne Grund und ohne eigene Legende (ADR 0034).
 * `GROUP` ist ein Sitz, den ein anderer Fahrgast derselben Buchung schon hat.
 */
type VisualState = 'FREE' | 'SELECTED' | 'GROUP' | 'TAKEN' | 'NOT_ONLINE' | 'BLOCKED';

/**
 * Klassen je Sitzstatus. Nicht nur die Farbe unterscheidet: Rahmen (durchgehend, gestrichelt,
 * Ring) und Durchstreichung tragen dieselbe Information für Menschen mit Farbsehschwäche.
 */
const STATE_CLASSES: Record<VisualState, string> = {
  FREE: 'border-solid border-brand-500 bg-white text-brand-800 hover:bg-brand-50 cursor-pointer',
  SELECTED: 'border-solid border-brand-800 bg-brand-600 text-white cursor-pointer',
  GROUP: 'border-solid border-brand-600 bg-brand-100 text-brand-900 ring-2 ring-brand-300',
  TAKEN: 'border-solid border-slate-400 bg-slate-300 text-slate-600 line-through',
  NOT_ONLINE: 'border-dashed border-slate-400 bg-white text-slate-500',
  BLOCKED: 'border-solid border-brand-100 bg-slate-100 text-slate-300',
};

const LEGEND: VisualState[] = ['FREE', 'SELECTED', 'GROUP', 'TAKEN', 'NOT_ONLINE', 'BLOCKED'];

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

const BUTTON =
  'self-start rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-brand-50 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600';

export interface SeatPickerProps {
  seatMap: SeatMapResponse;
  /** Geschlecht je Fahrgast aus den Fahrgastdaten; `null` ohne Geschlechtsregel. */
  genders: readonly (Gender | null)[];
  /** Name je Fahrgast, wie eingegeben; nur zur Orientierung auf dieser Seite. */
  names: readonly string[];
  assignment: Assignment;
  /** Fahrgast, für den gerade gewählt wird. */
  active: number;
  onActive: (passenger: number) => void;
  onToggle: (seat: SeatView) => void;
  busy: boolean;
  holding: boolean;
  /** Hinweis über dem Plan (etwa ein inzwischen vergebener Sitz); bekommt den Fokus. */
  notice: ReactNode;
  noticeAt: number | null;
  onHold: () => void;
  onEditDetails: () => void;
  /** Link zur Seite „Zahlweg wählen", sobald der Hold steht. */
  payHref: string | null;
}

/**
 * Sitzwahl nach den Fahrgastdaten (ADR 0034): Jeder Fahrgast bekommt einen Sitz. Für den gerade
 * gewählten Fahrgast sind die Sitze gesperrt, die für sein Geschlecht nicht wählbar sind; Sitze
 * neben Fahrgästen derselben Buchung sind erlaubt. Sitze sind native Checkboxen: Tab und
 * Leertaste reichen, Screenreader hören Sitz und Status. Verbindlich prüft der Hold.
 */
export function SeatPicker(props: SeatPickerProps): ReactNode {
  const t = useTranslations('trip');
  const tBooking = useTranslations('booking');
  const locale = useLocale() as Locale;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const { seatMap, assignment, active, noticeAt } = props;
  const passengers = assignment.length;
  const gender = props.genders[active] ?? null;
  const chosen = assignedCount(assignment);
  const complete = chosen === passengers;
  const separator = locale === 'ar' ? '، ' : ', ';
  const nameOf = (index: number): string =>
    props.names[index] || tBooking('passengerNumber', { number: String(index + 1) });
  const labelOf = (seatId: string | null): string | undefined =>
    seatId === null ? undefined : seatMap.seats.find((seat) => seat.seatId === seatId)?.label;

  useEffect(() => {
    if (noticeAt === null) {
      headingRef.current?.focus();
    } else {
      noticeRef.current?.focus();
    }
  }, [noticeAt]);

  const grid = buildSeatGrid(seatMap.seats);

  const visualOf = (seat: SeatView): { visual: VisualState; owner: number | null } => {
    const owner = passengerOfSeat(assignment, seat.seatId);
    if (owner === active) return { visual: 'SELECTED', owner };
    if (owner !== null) return { visual: 'GROUP', owner };
    const state = seatStateFor(seat, gender);
    return { visual: state === 'NOT_FOR_YOU' ? 'BLOCKED' : state, owner };
  };

  const renderCell = ({ seat, track }: SeatCell): ReactNode => {
    const { visual, owner } = visualOf(seat);
    const id = `seat-${seat.seatId}`;
    const stateText =
      visual === 'GROUP' && owner !== null
        ? t('states.GROUP', { name: nameOf(owner) })
        : t(`states.${visual === 'GROUP' ? 'SELECTED' : visual}`);
    return (
      <div key={seat.seatId} className={`${COLUMN_START[track] ?? ''} relative row-start-1`}>
        <input
          type="checkbox"
          id={id}
          name="seatId"
          value={seat.seatId}
          checked={owner !== null}
          disabled={props.busy || (visual !== 'FREE' && visual !== 'SELECTED')}
          onChange={() => props.onToggle(seat)}
          aria-label={t('seatName', { label: seat.label, state: stateText })}
          className="peer sr-only"
        />
        <label
          htmlFor={id}
          className={`relative flex h-12 w-full items-center justify-center rounded-lg border-2 text-sm font-semibold peer-disabled:cursor-not-allowed ${STATE_CLASSES[visual]} ${FOCUS_RING}`}
        >
          <span>{seat.label}</span>
          {owner !== null && passengers > 1 ? (
            <span
              aria-hidden="true"
              className="absolute -top-2 -end-2 flex size-5 items-center justify-center rounded-full bg-brand-900 text-xs text-white"
            >
              {String(owner + 1)}
            </span>
          ) : null}
        </label>
      </div>
    );
  };

  return (
    <section aria-labelledby="seat-map-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-slate-600">{t('stepSeats')}</p>
        <h2
          id="seat-map-heading"
          ref={headingRef}
          tabIndex={-1}
          className="text-xl font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          {t('seatMapHeading')}
        </h2>
        <p className="text-sm text-slate-600">{t('seatMapHint')}</p>
        <button
          type="button"
          onClick={props.onEditDetails}
          disabled={props.holding}
          className={BUTTON}
        >
          {t('editDetails')}
        </button>
      </div>

      <div ref={noticeRef} tabIndex={-1} className="focus-visible:outline-none">
        {props.notice}
      </div>

      {selectableSeatCount(seatMap.seats, props.genders) < passengers - chosen ? (
        <p role="alert" className="rounded-lg bg-amber-50 p-3 text-amber-900">
          {t('noFreeSeats')}
        </p>
      ) : null}

      {passengers > 1 ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 font-semibold">{t('seatFor')}</legend>
          <div className="flex flex-col gap-2">
            {assignment.map((seatId, index) => {
              const label = labelOf(seatId);
              return (
                <label key={index} className="relative">
                  <input
                    type="radio"
                    name="activePassenger"
                    value={String(index)}
                    checked={active === index}
                    onChange={() => props.onActive(index)}
                    className="peer sr-only"
                  />
                  <span
                    className={`flex min-h-11 cursor-pointer flex-wrap items-center gap-x-2 rounded-lg border-2 border-slate-300 bg-white px-3 py-2 peer-checked:border-brand-600 peer-checked:bg-brand-50 ${FOCUS_RING}`}
                  >
                    <span
                      aria-hidden="true"
                      className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-900 text-xs font-semibold text-white"
                    >
                      {String(index + 1)}
                    </span>
                    <span className="font-medium">{nameOf(index)}</span>
                    <span className="text-sm text-slate-600">
                      {label === undefined ? t('noSeatYet') : t('seatLabel', { label })}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      <p role="status" className="text-sm text-slate-700">
        {complete
          ? t('selectionStatus', { selected: String(chosen), max: String(passengers) })
          : `${t('selectionStatus', { selected: String(chosen), max: String(passengers) })} ${t('choosingFor', { name: nameOf(active) })}`}
      </p>

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
            className={`grid gap-1.5 ${GRID_COLUMNS[grid.tracks] ?? 'grid-cols-5'} ${row.bench ? 'mt-1 rounded-lg bg-slate-100 p-1' : ''}`}
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
          {LEGEND.filter((key) => key !== 'GROUP' || passengers > 1).map((key) => (
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
        className="sticky bottom-0 flex flex-col gap-2 rounded-t-2xl border border-brand-100 bg-white p-4 shadow-lg"
      >
        <h2 id="summary-heading" className="font-semibold">
          {t('summaryHeading')}
        </h2>
        <ul className="flex flex-col gap-1 text-sm">
          {assignment.map((seatId, index) => {
            const label = labelOf(seatId);
            return (
              <li key={index}>
                {label === undefined
                  ? t('summaryNoSeat', { name: nameOf(index) })
                  : t('summarySeat', { name: nameOf(index), label })}
              </li>
            );
          })}
        </ul>
        <p className="font-semibold">
          {t('total', { price: formatFare(seatMap.fare, locale, passengers) })}
        </p>
        <p className="text-sm text-slate-700">{tBooking('holdHint')}</p>
        <button
          type="button"
          disabled={props.busy || props.holding || !complete || props.payHref !== null}
          onClick={props.onHold}
          aria-describedby="hold-hint"
          className="rounded-lg bg-brand-600 px-4 py-3 font-semibold text-white hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600"
        >
          {props.holding || props.payHref !== null ? tBooking('submitting') : tBooking('submit')}
        </button>
        <p id="hold-hint" className="text-xs text-slate-600">
          {complete
            ? t('chosenSeats', {
                labels: assignment
                  .map(labelOf)
                  .filter((label) => label !== undefined)
                  .join(separator),
              })
            : t('chooseMore', {
                count: passengers - chosen,
                label: String(passengers - chosen),
              })}
        </p>
        {props.payHref === null ? null : (
          <p role="status" className="text-sm text-slate-700">
            {tBooking('held')}{' '}
            <a href={props.payHref} className="font-semibold underline">
              {tBooking('openPayment')}
            </a>
          </p>
        )}
      </section>
    </section>
  );
}
